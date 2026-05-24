import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { RefreshCw, Search, CheckCircle2, XCircle } from 'lucide-react';
import { AdminOnly } from '../components/auth/AdminOnly';
import { fetchAuditLogs, type AuditLogRow } from '../../lib/api';
import { toast } from 'sonner';
import { formatApiErrorToast } from '../../lib/apiClientError';

function AuditLogsAdmin() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLogs(await fetchAuditLogs());
    } catch (e) {
      toast.error(formatApiErrorToast(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = logs.filter((l) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      l.actor.toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      l.resource.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <div className="mb-8 flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Audit Logs</h1>
          <p className="text-muted-foreground">50 bản ghi mới nhất trong tenant của bạn</p>
        </div>
        <Button variant="outline" className="border-border" onClick={() => void load()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Làm mới
        </Button>
      </div>

      <Card className="p-4 mb-6 bg-card/80 border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Tìm actor, action, resource…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-input border-border"
          />
        </div>
      </Card>

      <Card className="rounded-2xl overflow-hidden bg-card/80 border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
              <tr>
                <th className="px-6 py-4">Thời gian</th>
                <th className="px-6 py-4">Actor</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Resource</th>
                <th className="px-6 py-4">Kết quả</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-muted-foreground">
                    Đang tải…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-muted-foreground">
                    Chưa có audit log — thao tác login/CRUD sẽ ghi tự động.
                  </td>
                </tr>
              ) : (
                filtered.map((log) => (
                  <tr key={log.id} className="border-b border-border/50 hover:bg-primary/5">
                    <td className="px-6 py-4 text-slate-400 whitespace-nowrap">{log.created_at}</td>
                    <td className="px-6 py-4 text-slate-300">{log.actor}</td>
                    <td className="px-6 py-4 text-slate-400">{log.role}</td>
                    <td className="px-6 py-4 font-mono text-xs text-primary">{log.action}</td>
                    <td className="px-6 py-4 text-slate-400 max-w-xs truncate">{log.resource}</td>
                    <td className="px-6 py-4">
                      <Badge
                        className={
                          log.result === 'success'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                        }
                      >
                        {log.result === 'success' ? (
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                        ) : (
                          <XCircle className="w-3 h-3 mr-1" />
                        )}
                        {log.result}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export function AuditLogs() {
  return (
    <AdminOnly title="Audit Logs" description="Đăng nhập để xem nhật ký thao tác admin.">
      <AuditLogsAdmin />
    </AdminOnly>
  );
}
