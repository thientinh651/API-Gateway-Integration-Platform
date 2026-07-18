import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { UndoDeleteToast } from '../app/components/UndoDeleteToast';
import { fetchGatewaySettings } from '../lib/api';
import { useAdminAuth } from './AdminAuthContext';

export type UndoDeleteEntity = 'route' | 'client' | 'user';

type ScheduleDeleteArgs = {
  entity: UndoDeleteEntity;
  id: string | number;
  label: string;
  execute: () => Promise<void>;
};

type ScheduleBulkDeleteArgs = {
  entity: UndoDeleteEntity;
  ids: Array<string | number>;
  label: string;
  execute: () => Promise<void>;
};

type PendingEntry = {
  key: string;
  timer: ReturnType<typeof setTimeout>;
  toastId: string | number;
  execute: () => Promise<void>;
};

type UndoDeleteContextValue = {
  undoSeconds: number;
  loading: boolean;
  refreshUndoSeconds: () => Promise<void>;
  isPendingDelete: (entity: UndoDeleteEntity, id: string | number) => boolean;
  pendingIdSet: (entity: UndoDeleteEntity) => Set<string>;
  scheduleDelete: (args: ScheduleDeleteArgs) => void;
  scheduleBulkDelete: (args: ScheduleBulkDeleteArgs) => void;
};

const UndoDeleteContext = createContext<UndoDeleteContextValue | null>(null);

function pendingKey(entity: UndoDeleteEntity, id: string | number): string {
  return `${entity}:${String(id)}`;
}

const DEFAULT_UNDO_SECONDS = 10;

export function UndoDeleteProvider({ children }: { children: ReactNode }) {
  const { user } = useAdminAuth();
  const [undoSeconds, setUndoSeconds] = useState(DEFAULT_UNDO_SECONDS);
  const [loading, setLoading] = useState(true);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());
  const pendingRef = useRef<Map<string, PendingEntry>>(new Map());

  const refreshUndoSeconds = useCallback(async () => {
    try {
      const data = await fetchGatewaySettings();
      const secs = Number(data.undo_delete_seconds);
      setUndoSeconds(Number.isFinite(secs) ? Math.max(0, Math.min(120, secs)) : DEFAULT_UNDO_SECONDS);
    } catch {
      /* giữ giá trị hiện tại */
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchGatewaySettings();
        if (cancelled) return;
        const secs = Number(data.undo_delete_seconds);
        setUndoSeconds(Number.isFinite(secs) ? Math.max(0, Math.min(120, secs)) : DEFAULT_UNDO_SECONDS);
      } catch {
        if (!cancelled) setUndoSeconds(DEFAULT_UNDO_SECONDS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    return () => {
      for (const entry of pendingRef.current.values()) {
        clearTimeout(entry.timer);
        toast.dismiss(entry.toastId);
      }
      pendingRef.current.clear();
    };
  }, []);

  const addPendingKeys = useCallback((keys: string[]) => {
    setPendingKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, []);

  const removePendingKeys = useCallback((keys: string[]) => {
    setPendingKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
    for (const k of keys) pendingRef.current.delete(k);
  }, []);

  const commitDelete = useCallback(
    async (keys: string[], execute: () => Promise<void>, toastId: string | number) => {
      toast.dismiss(toastId);
      try {
        await execute();
      } catch (e) {
        removePendingKeys(keys);
        toast.error(e instanceof Error ? e.message : String(e));
        return;
      }
      removePendingKeys(keys);
    },
    [removePendingKeys],
  );

  const undoDelete = useCallback(
    (keys: string[], toastId: string | number, label: string) => {
      for (const k of keys) {
        const entry = pendingRef.current.get(k);
        if (entry) clearTimeout(entry.timer);
      }
      toast.dismiss(toastId);
      removePendingKeys(keys);
      toast.success(`Đã hoàn tác: ${label}`);
    },
    [removePendingKeys],
  );

  const startPending = useCallback(
    (keys: string[], label: string, message: string, execute: () => Promise<void>, seconds: number) => {
      if (keys.some((k) => pendingRef.current.has(k))) return;

      if (seconds <= 0) {
        void (async () => {
          try {
            await execute();
            toast.success(message);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          }
        })();
        return;
      }

      const durationMs = seconds * 1000;
      const toastId = `undo-delete-${keys.join('_')}-${Date.now()}`;
      toast.custom(
        () => (
          <UndoDeleteToast
            message={message}
            durationMs={durationMs}
            onUndo={() => undoDelete(keys, toastId, label)}
          />
        ),
        {
          id: toastId,
          duration: Infinity,
          closeButton: false,
          position: 'bottom-center',
          unstyled: true,
          className: 'avaso-undo-toast',
        },
      );

      const timer = setTimeout(() => {
        void commitDelete(keys, execute, toastId);
      }, durationMs);

      const entryBase = { timer, toastId, execute };
      for (const key of keys) {
        pendingRef.current.set(key, { ...entryBase, key });
      }
      addPendingKeys(keys);
    },
    [addPendingKeys, commitDelete, undoDelete],
  );

  const scheduleDelete = useCallback(
    ({ entity, id, label, execute }: ScheduleDeleteArgs) => {
      const key = pendingKey(entity, id);
      startPending([key], label, `Đã xóa ${label}`, execute, undoSeconds);
    },
    [startPending, undoSeconds],
  );

  const scheduleBulkDelete = useCallback(
    ({ entity, ids, label, execute }: ScheduleBulkDeleteArgs) => {
      const keys = ids.map((id) => pendingKey(entity, id));
      startPending(keys, label, `Đã xóa ${label}`, execute, undoSeconds);
    },
    [startPending, undoSeconds],
  );

  const isPendingDelete = useCallback(
    (entity: UndoDeleteEntity, id: string | number) => pendingKeys.has(pendingKey(entity, id)),
    [pendingKeys],
  );

  const pendingIdSet = useCallback(
    (entity: UndoDeleteEntity) => {
      const prefix = `${entity}:`;
      const out = new Set<string>();
      for (const k of pendingKeys) {
        if (k.startsWith(prefix)) out.add(k.slice(prefix.length));
      }
      return out;
    },
    [pendingKeys],
  );

  const value = useMemo(
    () => ({
      undoSeconds,
      loading,
      refreshUndoSeconds,
      isPendingDelete,
      pendingIdSet,
      scheduleDelete,
      scheduleBulkDelete,
    }),
    [
      undoSeconds,
      loading,
      refreshUndoSeconds,
      isPendingDelete,
      pendingIdSet,
      scheduleDelete,
      scheduleBulkDelete,
    ],
  );

  return <UndoDeleteContext.Provider value={value}>{children}</UndoDeleteContext.Provider>;
}

export function useUndoDelete(): UndoDeleteContextValue {
  const ctx = useContext(UndoDeleteContext);
  if (!ctx) {
    throw new Error('useUndoDelete must be used within UndoDeleteProvider');
  }
  return ctx;
}
