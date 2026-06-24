import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { ConfirmDangerButton } from '../components/forms/ConfirmDangerButton';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { RefreshCw, Trash2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  bulkDeleteProxyQueueItems,
  deleteProxyQueueItem,
  fetchProxyQueue,
  retryProxyQueueItem,
  type ProxyQueueItem,
} from '../../lib/api';
import { toastApiError } from '../../lib/apiClientError';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { canMutateProxyQueue } from '../../lib/rbac';
import { formatUnixTimestamp } from '../../lib/formatDbTimestamp';
import { AdminOnly } from '../components/auth/AdminOnly';

function ProxyQueueAdmin() {
  const { user } = useAdminAuth();
  const canMutate = canMutateProxyQueue(user);
  const [items, setItems] = useState<ProxyQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchProxyQueue();
      setItems(next);
      setSelected((prev) => {
        const valid = new Set(next.map((i) => i.id));
        const kept = new Set([...prev].filter((id) => valid.has(id)));
        return kept.size === prev.size ? prev : kept;
      });
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0;
  const selectedCount = useMemo(() => selected.size, [selected]);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };

  const runBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const ids = [...selected];
      const { deleted } = await bulkDeleteProxyQueueItems(ids);
      toast.success(`Đã xóa ${deleted} bản ghi`);
      setSelected(new Set());
      await load();
    } catch (e) {
      toastApiError(e);
    } finally {
      setBulkBusy(false);
    }
  };

  const colSpan = canMutate ? 9 : 8;

  return (
    <>
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Proxy Queue</h1>
        </div>
        <Button variant="outline" className="border-border" onClick={() => void load()} disabled={loading || bulkBusy}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card className="rounded-2xl overflow-hidden bg-card/80 border-border">
        {canMutate ? (
          <div
            className={`px-4 sm:px-6 border-b border-border bg-slate-950/50 flex flex-wrap items-center gap-2 min-h-[52px] transition-opacity ${
              someSelected ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            aria-hidden={!someSelected}
          >
            <span className="text-xs text-slate-400">{selectedCount} đã chọn</span>
            <ConfirmDangerButton
              size="sm"
              variant="outline"
              className="h-8 text-xs border-destructive/50 text-destructive"
              disabled={bulkBusy || !someSelected}
              title="Xóa các bản ghi đã chọn?"
              description={`Xóa ${selectedCount} mục khỏi DLQ — không retry được nữa.`}
              confirmLabel="Xóa đã chọn"
              onConfirm={runBulkDelete}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Xóa đã chọn
            </ConfirmDangerButton>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground"
              disabled={bulkBusy || !someSelected}
              onClick={() => setSelected(new Set())}
            >
              Bỏ chọn
            </Button>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
              <tr>
                {canMutate ? (
                  <th className="px-3 py-3 w-10">
                    <Checkbox
                      aria-label="Chọn tất cả"
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={() => toggleAll()}
                      disabled={loading || items.length === 0 || bulkBusy}
                    />
                  </th>
                ) : null}
                <th className="px-4 py-3">Thời gian</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Path</th>
                <th className="px-4 py-3">Upstream</th>
                <th className="px-4 py-3">Lý do fail</th>
                <th className="px-4 py-3">Retry đã thử</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border/50 hover:bg-primary/5">
                  {canMutate ? (
                    <td className="px-3 py-3 w-10 align-middle">
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => toggleOne(item.id)}
                        aria-label={`Chọn ${item.method} ${item.path}`}
                        disabled={bulkBusy || busyId === item.id}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {formatUnixTimestamp(item.created_at_unix)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/30 border text-[10px]">
                      pending
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="font-mono">{item.method}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300 max-w-[180px] truncate" title={item.path}>
                    {item.path}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-slate-500 max-w-[160px] truncate" title={item.upstream_url}>
                    {item.upstream_url}
                  </td>
                  <td className="px-4 py-3 text-xs text-amber-200 max-w-[200px]" title={item.failure_reason}>
                    {item.failure_reason}
                  </td>
                  <td className="px-4 py-3 text-slate-400 font-mono">{item.retry_attempts}×</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {canMutate ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border"
                          disabled={busyId === item.id || bulkBusy}
                          onClick={async () => {
                            setBusyId(item.id);
                            try {
                              const r = await retryProxyQueueItem(item.id);
                              toast.success(`Retry OK — upstream ${r.upstream_status}`);
                              setSelected((prev) => {
                                if (!prev.has(item.id)) return prev;
                                const next = new Set(prev);
                                next.delete(item.id);
                                return next;
                              });
                              await load();
                            } catch (e) {
                              toastApiError(e);
                            } finally {
                              setBusyId(null);
                            }
                          }}
                        >
                          <RotateCw className="w-3 h-3 mr-1" />
                          Retry
                        </Button>
                        <ConfirmDangerButton
                          size="sm"
                          variant="outline"
                          className="border-destructive/50 text-destructive"
                          disabled={busyId === item.id || bulkBusy}
                          title="Xóa khỏi queue?"
                          description={`Xóa bản ghi DLQ ${item.method} ${item.path} — không retry được nữa.`}
                          confirmLabel="Xóa"
                          onConfirm={async () => {
                            setBusyId(item.id);
                            try {
                              await deleteProxyQueueItem(item.id);
                              toast.success('Đã xóa');
                              setSelected((prev) => {
                                if (!prev.has(item.id)) return prev;
                                const next = new Set(prev);
                                next.delete(item.id);
                                return next;
                              });
                              await load();
                            } catch (e) {
                              toastApiError(e);
                            } finally {
                              setBusyId(null);
                            }
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </ConfirmDangerButton>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Viewer: chỉ xem</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground text-sm max-w-lg mx-auto">
                    <p className="mb-2">Chưa có bản ghi — DLQ lưu <strong className="text-slate-300">PostgreSQL</strong>.</p>
                    <p className="text-xs leading-relaxed">
                      Retry xóa entry khỏi queue (idempotent — replay 2 lần không được). Bật DLQ trong Settings.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export function ProxyQueuePage() {
  return (
    <AdminOnly title="Proxy Queue" description="Đăng nhập để xem DLQ.">
      <ProxyQueueAdmin />
    </AdminOnly>
  );
}
