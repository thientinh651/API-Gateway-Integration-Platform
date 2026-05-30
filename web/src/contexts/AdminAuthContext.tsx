import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { adminMe, type AdminMe } from '../lib/api';
import { registerSessionExpiryHandler, setSessionActive } from '../lib/sessionExpiry';

type AdminAuthContextValue = {
  user: AdminMe | null;
  loading: boolean;
  refresh: () => Promise<void>;
  clearUser: () => void;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await adminMe();
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  const clearUser = useCallback(() => {
    setSessionActive(false);
    setUser(null);
  }, []);

  useEffect(() => {
    return registerSessionExpiryHandler(() => setUser(null));
  }, []);

  useEffect(() => {
    setSessionActive(user != null);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const me = await adminMe();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, clearUser }),
    [user, loading, refresh, clearUser]
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
