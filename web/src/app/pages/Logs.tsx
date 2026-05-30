import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { RefreshCw, Download, Search } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { fetchTransactionLogs, type TransactionLogRow } from '../../lib/api';
import { toastApiError } from '../../lib/apiClientError';
import { formatDbTimestamp, formatDbTimestampForExport } from '../../lib/formatDbTimestamp';

function exportCsv(rows: TransactionLogRow[]) {
  const header = [
    'timestamp',
    'request_id',
    'method',
    'path',
    'status',
    'duration_ms',
    'client_ip',
    'api_key_masked',
    'outcome',
    'reason',
  ];
  const lines = rows.map((r) =>
    [
      formatDbTimestampForExport(r.created_at),
      r.request_id,
      r.method,
      r.path,
      r.status,
      r.duration_ms,
      r.client_ip ?? '',
      r.api_key_masked ?? '',
      r.outcome,
      r.reason,
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
  a.download = `transaction-logs-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Logs() {
  const [logs, setLogs] = useState<TransactionLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLogs(
        await fetchTransactionLogs({
          limit: 200,
          method: methodFilter,
          status: statusFilter as 'all' | '2xx' | '4xx' | '5xx',
          search: searchTerm,
        })
      );
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, [methodFilter, statusFilter, searchTerm]);

  useEffect(() => {
    const t = setTimeout(() => void load(), searchTerm ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, searchTerm]);

  const getStatusBadgeClass = (status: number) => {
    if (status >= 200 && status < 300)
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (status >= 400 && status < 500)
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    if (status >= 500) return 'bg-red-500/10 text-red-400 border-red-500/20';
    return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  };

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      POST: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      PUT: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      DELETE: 'bg-red-500/10 text-red-400 border-red-500/20',
      PATCH: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    };
    return colors[method] || 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Transaction Logs</h1>
        <p className="text-muted-foreground">
          Request qua data-plane gateway — lưu SQLite, tối đa 200 bản ghi gần nhất
        </p>
      </div>

      <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6 mb-6">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Tìm kiếm theo path, request ID, IP..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-input border-border text-foreground"
              />
            </div>
          </div>
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="w-[150px] bg-input border-border text-foreground">
              <SelectValue placeholder="Method" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">All Methods</SelectItem>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
              <SelectItem value="PATCH">PATCH</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px] bg-input border-border text-foreground">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="2xx">2xx Success</SelectItem>
              <SelectItem value="4xx">4xx Client Error</SelectItem>
              <SelectItem value="5xx">5xx Server Error</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="border-border"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            className="border-border"
            onClick={() => exportCsv(logs)}
            disabled={logs.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </Card>

      <Card className="rounded-2xl overflow-hidden bg-card/80 backdrop-blur-sm border-border">
        <div className="p-6 border-b border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider">
            Logs ({logs.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Request ID</th>
                <th className="px-6 py-4">Method</th>
                <th className="px-6 py-4">Path</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Duration</th>
                <th className="px-6 py-4">Client IP</th>
                <th className="px-6 py-4">API Key</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">
                    Đang tải…
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">
                    Chưa có log — gửi request qua data-plane để ghi tự động.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-b border-border/50 hover:bg-primary/5">
                    <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                      {formatDbTimestamp(log.created_at)}
                    </td>
                    <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                      {log.request_id}
                    </td>
                    <td className="px-6 py-4">
                      <Badge className={`${getMethodColor(log.method)} border font-mono text-xs`}>
                        {log.method}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-slate-300 font-mono text-xs">{log.path}</td>
                    <td className="px-6 py-4">
                      <Badge className={`${getStatusBadgeClass(log.status)} border font-mono`}>
                        {log.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-slate-400">{log.duration_ms}ms</td>
                    <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                      {log.client_ip ?? '—'}
                    </td>
                    <td className="px-6 py-4 text-slate-500 font-mono text-xs">
                      {log.api_key_masked ?? '—'}
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
