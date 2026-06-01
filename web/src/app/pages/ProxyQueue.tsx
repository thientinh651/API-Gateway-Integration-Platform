import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { RefreshCw, Trash2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import {
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchProxyQueue());
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="mb-8 flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Proxy Queue (DLQ)</h1>
          <p className="text-muted-foreground max-w-2xl">
            Request lỗi (timeout, không kết nối upstream, HTTP 5xx sau retry) khi DLQ bật trong Cài đặt.
            In-memory — mất khi restart gateway. Demo: gọi{' '}
            <code className="text-primary text-sm">/v1/api/status/503</code> qua Thử Proxy.
          </p>
        </div>
        <Button variant="outline" className="border-border" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card className="rounded-2xl overflow-hidden bg-card/80 border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
              <tr>
                <th className="px-4 py-3">Thời gian</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Path</th>
                <th className="px-4 py-3">Lý do</th>
                <th className="px-4 py-3">Retry</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border/50 hover:bg-primary/5">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {formatUnixTimestamp(item.created_at_unix)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="font-mono">{item.method}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300 max-w-[240px] truncate">
                    {item.path}
                  </td>
                  <td className="px-4 py-3 text-xs text-amber-200">{item.failure_reason}</td>
                  <td className="px-4 py-3 text-slate-400">{item.retry_attempts}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {canMutate ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border"
                          disabled={busyId === item.id}
                          onClick={async () => {
                            setBusyId(item.id);
                            try {
                              const r = await retryProxyQueueItem(item.id);
                              toast.success(`Retry OK — upstream ${r.upstream_status}`);
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
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-destructive/50 text-destructive"
                          disabled={busyId === item.id}
                          onClick={async () => {
                            setBusyId(item.id);
                            try {
                              await deleteProxyQueueItem(item.id);
                              toast.success('Đã xóa');
                              await load();
                            } catch (e) {
                              toastApiError(e);
                            } finally {
                              setBusyId(null);
                            }
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Viewer: chỉ xem</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    Hàng đợi trống — bật Retry + Queue (Settings + Route).
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
