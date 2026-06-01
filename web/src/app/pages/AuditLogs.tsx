import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { RefreshCw, Search, CheckCircle2, XCircle, Download } from 'lucide-react';
import { AdminOnly } from '../components/auth/AdminOnly';
import { fetchAuditLogs, type AuditLogRow } from '../../lib/api';
import { toastApiError } from '../../lib/apiClientError';
import { formatDbTimestamp, formatDbTimestampForExport } from '../../lib/formatDbTimestamp';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

function exportCsv(rows: AuditLogRow[]) {
  const header = ['created_at', 'actor', 'role', 'action', 'resource', 'result', 'source_ip', 'details'];
  const lines = rows.map((r) =>
    [
      formatDbTimestampForExport(r.created_at),
      r.actor,
      r.role,
      r.action,
      r.resource,
      r.result,
      r.source_ip ?? '',
      r.details ?? '',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-logs-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function AuditLogsAdmin() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLogs(
        await fetchAuditLogs({
          limit: 200,
          result: resultFilter as 'all' | 'success' | 'failure',
          search,
        })
      );
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, [resultFilter, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <>
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Audit Logs</h1>
          <p className="text-muted-foreground">
            Thao tác admin (login, CRUD, RBAC) — tối đa 200 bản ghi gần nhất
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="border-border"
            onClick={() => exportCsv(logs)}
            disabled={logs.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" className="border-border" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </Button>
        </div>
      </div>

      <Card className="p-4 mb-6 bg-card/80 border-border">
        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Tìm actor, action, resource…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-input border-border"
            />
          </div>
          <Select value={resultFilter} onValueChange={setResultFilter}>
            <SelectTrigger className="w-[160px] bg-input border-border">
              <SelectValue placeholder="Kết quả" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">Tất cả</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failure">Failure</SelectItem>
            </SelectContent>
          </Select>
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
                <th className="px-6 py-4">IP</th>
                <th className="px-6 py-4">Kết quả</th>
                <th className="px-6 py-4">Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-muted-foreground">
                    Đang tải…
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-muted-foreground">
                    Chưa có audit log — thao tác login/CRUD sẽ ghi tự động.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-b border-border/50 hover:bg-primary/5">
                    <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                      {formatDbTimestamp(log.created_at)}
                    </td>
                    <td className="px-6 py-4 text-slate-300">{log.actor}</td>
                    <td className="px-6 py-4 text-slate-400">{log.role}</td>
                    <td className="px-6 py-4 font-mono text-xs text-primary">{log.action}</td>
                    <td className="px-6 py-4 text-slate-400 max-w-xs truncate">{log.resource}</td>
                    <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                      {log.source_ip ?? '—'}
                    </td>
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
                    <td className="px-6 py-4 text-xs text-muted-foreground max-w-[12rem] truncate">
                      {log.details ?? '—'}
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
