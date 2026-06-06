import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { RefreshCw, Download, Search, CheckCircle2, XCircle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  fetchAuditLogs,
  fetchTransactionLogs,
  type AuditLogRow,
  type TransactionLogRow,
} from '../../lib/api';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { canViewAudit, canViewLogs } from '../../lib/rbac';
import { toastApiError } from '../../lib/apiClientError';
import { formatDbTimestamp, formatDbTimestampForExport } from '../../lib/formatDbTimestamp';

type LogKind = 'traffic' | 'admin';
type KindFilter = 'all' | LogKind;

type UnifiedLogEntry =
  | { kind: 'traffic'; sortKey: string; row: TransactionLogRow }
  | { kind: 'admin'; sortKey: string; row: AuditLogRow };

function parseSortKey(createdAt: string, id: number): string {
  return `${createdAt}#${id}`;
}

function mergeLogs(traffic: TransactionLogRow[], admin: AuditLogRow[]): UnifiedLogEntry[] {
  const entries: UnifiedLogEntry[] = [
    ...traffic.map((row) => ({
      kind: 'traffic' as const,
      sortKey: parseSortKey(row.created_at, row.id),
      row,
    })),
    ...admin.map((row) => ({
      kind: 'admin' as const,
      sortKey: parseSortKey(row.created_at, row.id),
      row,
    })),
  ];
  entries.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
  return entries.slice(0, 200);
}

function exportCsv(entries: UnifiedLogEntry[]) {
  const header = [
    'kind',
    'created_at',
    'summary',
    'detail',
    'ip',
    'result',
    'extra',
  ];
  const lines = entries.map((e) => {
    if (e.kind === 'traffic') {
      const r = e.row;
      return [
        'traffic',
        formatDbTimestampForExport(r.created_at),
        `${r.method} ${r.path}`,
        `${r.status} ${r.duration_ms}ms`,
        r.client_ip ?? '',
        r.outcome,
        r.api_key_masked ?? '',
      ];
    }
    const r = e.row;
    return [
      'admin',
      formatDbTimestampForExport(r.created_at),
      `${r.action} → ${r.resource}`,
      `${r.actor} (${r.role})`,
      r.source_ip ?? '',
      r.result,
      r.details ?? '',
    ];
  });
  const csv = [header, ...lines]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `log-van-hanh-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function getStatusBadgeClass(status: number) {
  if (status >= 200 && status < 300) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (status >= 400 && status < 500) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  if (status >= 500) return 'bg-red-500/10 text-red-400 border-red-500/20';
  return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
}

function getMethodColor(method: string) {
  const colors: Record<string, string> = {
    GET: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    POST: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    PUT: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    DELETE: 'bg-red-500/10 text-red-400 border-red-500/20',
    PATCH: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  };
  return colors[method] || 'bg-slate-500/10 text-slate-400 border-slate-500/20';
}

export function Logs() {
  const { user } = useAdminAuth();
  const showTraffic = canViewLogs(user);
  const showAdmin = canViewAudit(user);
  const [params, setParams] = useSearchParams();

  const [entries, setEntries] = useState<UnifiedLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>(() => {
    const k = params.get('kind');
    if (k === 'admin' || k === 'traffic') return k;
    return 'all';
  });
  const [methodFilter, setMethodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');

  const effectiveKind = useMemo((): KindFilter => {
    if (kindFilter === 'traffic' && !showTraffic) return showAdmin ? 'admin' : 'all';
    if (kindFilter === 'admin' && !showAdmin) return showTraffic ? 'traffic' : 'all';
    if (kindFilter === 'all') {
      if (showTraffic && showAdmin) return 'all';
      if (showTraffic) return 'traffic';
      if (showAdmin) return 'admin';
    }
    return kindFilter;
  }, [kindFilter, showTraffic, showAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetchTraffic =
        showTraffic && (effectiveKind === 'all' || effectiveKind === 'traffic');
      const fetchAdmin =
        showAdmin && (effectiveKind === 'all' || effectiveKind === 'admin');

      const outcomeParam =
        resultFilter === 'all' ? undefined : (resultFilter as 'success' | 'failure');

      const [traffic, admin] = await Promise.all([
        fetchTraffic
          ? fetchTransactionLogs({
              limit: 200,
              method: methodFilter,
              status: statusFilter as 'all' | '2xx' | '4xx' | '5xx',
              outcome: outcomeParam,
              search: searchTerm,
            })
          : Promise.resolve([] as TransactionLogRow[]),
        fetchAdmin
          ? fetchAuditLogs({
              limit: 200,
              result: outcomeParam ?? 'all',
              search: searchTerm,
            })
          : Promise.resolve([] as AuditLogRow[]),
      ]);

      setEntries(mergeLogs(traffic, admin));
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, [
    showTraffic,
    showAdmin,
    effectiveKind,
    methodFilter,
    statusFilter,
    resultFilter,
    searchTerm,
  ]);

  useEffect(() => {
    const t = setTimeout(() => void load(), searchTerm ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, searchTerm]);

  useEffect(() => {
    const current = params.get('kind');
    const desired = effectiveKind === 'all' ? null : effectiveKind;
    if (current === desired) return;
    const next = new URLSearchParams(params);
    if (desired) next.set('kind', desired);
    else next.delete('kind');
    setParams(next, { replace: true });
  }, [effectiveKind, params, setParams]);

  const trafficCount = entries.filter((e) => e.kind === 'traffic').length;
  const adminCount = entries.filter((e) => e.kind === 'admin').length;

  const showMethodStatusFilters =
    showTraffic && (effectiveKind === 'all' || effectiveKind === 'traffic');
  const showResultFilter =
    (showTraffic && (effectiveKind === 'all' || effectiveKind === 'traffic')) ||
    (showAdmin && (effectiveKind === 'all' || effectiveKind === 'admin'));

  return (
    <>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Log vận hành</h1>
      </div>

      <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-4 sm:p-6 mb-6 space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Tìm path, user, action, IP, request ID…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-input border-border text-foreground"
            />
          </div>

          {showTraffic && showAdmin ? (
            <Select
              value={effectiveKind}
              onValueChange={(v) => setKindFilter(v as KindFilter)}
            >
              <SelectTrigger className="w-[160px] bg-input border-border">
                <SelectValue placeholder="Loại" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">Tất cả loại</SelectItem>
                <SelectItem value="traffic">Traffic (API)</SelectItem>
                <SelectItem value="admin">Quản trị</SelectItem>
              </SelectContent>
            </Select>
          ) : null}

          {showMethodStatusFilters ? (
            <>
              <Select value={methodFilter} onValueChange={setMethodFilter}>
                <SelectTrigger className="w-[130px] bg-input border-border">
                  <SelectValue placeholder="Method" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="all">Mọi method</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={setStatusFilter}
              >
                <SelectTrigger className="w-[130px] bg-input border-border">
                  <SelectValue placeholder="HTTP" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="all">Mọi HTTP</SelectItem>
                  <SelectItem value="2xx">2xx</SelectItem>
                  <SelectItem value="4xx">4xx</SelectItem>
                  <SelectItem value="5xx">5xx</SelectItem>
                </SelectContent>
              </Select>
            </>
          ) : null}

          {showResultFilter ? (
            <Select value={resultFilter} onValueChange={setResultFilter}>
              <SelectTrigger className="w-[140px] bg-input border-border">
                <SelectValue placeholder="Kết quả" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">Mọi kết quả</SelectItem>
                <SelectItem value="success">Thành công</SelectItem>
                <SelectItem value="failure">Thất bại</SelectItem>
              </SelectContent>
            </Select>
          ) : null}

          <Button
            variant="outline"
            className="border-border"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </Button>
          <Button
            variant="outline"
            className="border-border"
            onClick={() => exportCsv(entries)}
            disabled={entries.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Xuất CSV
          </Button>
        </div>

        {!loading && effectiveKind === 'all' && showTraffic && showAdmin ? (
          <p className="text-xs text-muted-foreground">
            Hiển thị {entries.length} sự kiện gần nhất — {trafficCount} traffic, {adminCount}{' '}
            quản trị
            {resultFilter !== 'all'
              ? ` · lọc kết quả: ${resultFilter === 'success' ? 'thành công' : 'thất bại'} (traffic: outcome; audit: result)`
              : ''}
          </p>
        ) : !loading && resultFilter !== 'all' ? (
          <p className="text-xs text-muted-foreground">
            Lọc kết quả: {resultFilter === 'success' ? 'thành công' : 'thất bại'} — traffic theo{' '}
            <code className="text-slate-400">outcome</code>, audit theo{' '}
            <code className="text-slate-400">result</code>. HTTP 200 chỉ hiện khi thành công.
          </p>
        ) : null}
      </Card>

      <Card className="rounded-2xl overflow-hidden bg-card/80 backdrop-blur-sm border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
              <tr>
                <th className="px-4 sm:px-6 py-4">Thời gian</th>
                <th className="px-4 sm:px-6 py-4">Loại</th>
                <th className="px-4 sm:px-6 py-4">Sự kiện</th>
                <th className="px-4 sm:px-6 py-4 hidden md:table-cell">Chi tiết</th>
                <th className="px-4 sm:px-6 py-4 hidden lg:table-cell">IP</th>
                <th className="px-4 sm:px-6 py-4">Kết quả</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    Đang tải…
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    Không có bản ghi — thử đổi bộ lọc hoặc thực hiện thao tác / gọi API.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  if (entry.kind === 'traffic') {
                    const log = entry.row;
                    return (
                      <tr
                        key={`t-${log.id}`}
                        className="border-b border-border/50 hover:bg-primary/5"
                      >
                        <td className="px-4 sm:px-6 py-3 text-slate-400 font-mono text-xs whitespace-nowrap">
                          {formatDbTimestamp(log.created_at)}
                        </td>
                        <td className="px-4 sm:px-6 py-3">
                          <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/25 border text-[10px]">
                            Traffic
                          </Badge>
                        </td>
                        <td className="px-4 sm:px-6 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                              className={`${getMethodColor(log.method)} border font-mono text-[10px]`}
                            >
                              {log.method}
                            </Badge>
                            <span className="font-mono text-xs text-slate-300 truncate max-w-[14rem]">
                              {log.path}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                            {log.request_id}
                          </p>
                        </td>
                        <td className="px-4 sm:px-6 py-3 hidden md:table-cell text-xs text-slate-400">
                          {log.duration_ms}ms
                          {log.api_key_masked ? ` · ${log.api_key_masked}` : ''}
                        </td>
                        <td className="px-4 sm:px-6 py-3 hidden lg:table-cell font-mono text-xs text-slate-500">
                          {log.client_ip ?? '—'}
                        </td>
                        <td className="px-4 sm:px-6 py-3">
                          <Badge className={`${getStatusBadgeClass(log.status)} border font-mono`}>
                            {log.status}
                          </Badge>
                          {log.outcome !== 'success' ? (
                            <p className="text-[10px] text-red-400/90 mt-0.5 font-mono">{log.outcome}</p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  }

                  const log = entry.row;
                  return (
                    <tr
                      key={`a-${log.id}`}
                      className="border-b border-border/50 hover:bg-primary/5"
                    >
                      <td className="px-4 sm:px-6 py-3 text-slate-400 font-mono text-xs whitespace-nowrap">
                        {formatDbTimestamp(log.created_at)}
                      </td>
                      <td className="px-4 sm:px-6 py-3">
                        <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/25 border text-[10px]">
                          Quản trị
                        </Badge>
                      </td>
                      <td className="px-4 sm:px-6 py-3">
                        <p className="font-mono text-xs text-primary">{log.action}</p>
                        <p className="text-xs text-slate-400 truncate max-w-[14rem]">{log.resource}</p>
                      </td>
                      <td className="px-4 sm:px-6 py-3 hidden md:table-cell text-xs text-slate-400">
                        {log.actor}
                        <span className="text-muted-foreground"> · {log.role}</span>
                        {log.details ? (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[12rem] mt-0.5">
                            {log.details}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 sm:px-6 py-3 hidden lg:table-cell font-mono text-xs text-slate-500">
                        {log.source_ip ?? '—'}
                      </td>
                      <td className="px-4 sm:px-6 py-3">
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
