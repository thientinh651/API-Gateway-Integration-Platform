import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
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
import { toast } from 'sonner';
import { formatDbTimestamp, formatDbTimestampForExport } from '../../lib/formatDbTimestamp';
import { reasonLabel, MIDDLEWARE_REASON_FILTER_OPTIONS } from '../../lib/middlewareLabels';
import { MiddlewareStageBadge } from '../components/auth/MiddlewareStageBadge';

type LogKind = 'traffic' | 'admin';
type KindFilter = 'all' | LogKind;

const HTTP_STATUS_FILTER_HINT: Record<string, string> = {
  all: 'Mọi mã phản hồi HTTP',
  '2xx': 'Thành công — 200, 201… (request OK)',
  '4xx': 'Lỗi phía client — 401 auth, 404 route, 429 rate limit…',
  '5xx': 'Lỗi upstream/server — 502, 504 timeout…',
};

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
    'outcome',
    'middleware_reason',
    'client_key_id',
    'api_key_masked',
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
        reasonLabel(r.reason),
        r.client_key_id != null ? String(r.client_key_id) : '',
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
      '',
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

/** Grid 6 cột — Loại · Sự kiện · Thời gian · Chi tiết · IP · Kết quả */
const LOG_GRID =
  'grid w-full min-w-0 grid-cols-[10%_27%_13%_22%_13%_15%] items-center';
const LOG_CELL = 'px-4 sm:px-6 py-3 min-w-0';
const LOG_HEAD =
  'text-[10px] uppercase text-muted-foreground font-bold whitespace-nowrap bg-slate-950';

function LogColumnHeader() {
  return (
    <div className={`${LOG_GRID} border-b border-slate-700/60 bg-slate-950`}>
      <div className={`${LOG_CELL} ${LOG_HEAD}`}>Loại</div>
      <div className={`${LOG_CELL} ${LOG_HEAD}`}>Sự kiện</div>
      <div className={`${LOG_CELL} ${LOG_HEAD}`}>Thời gian</div>
      <div className={`${LOG_CELL} ${LOG_HEAD} hidden sm:block`}>Chi tiết</div>
      <div className={`${LOG_CELL} ${LOG_HEAD} hidden sm:block`}>IP</div>
      <div className={`${LOG_CELL} ${LOG_HEAD}`}>Kết quả</div>
    </div>
  );
}

const LOG_DETAIL_INLINE_MAX = 52;

function LogDetailText({
  text,
  title = 'Chi tiết',
  className = 'text-xs text-slate-400',
  onAction,
  actionLabel = 'Lọc',
}: {
  text: string;
  title?: string;
  className?: string;
  onAction?: () => void;
  actionLabel?: string;
}) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.length <= LOG_DETAIL_INLINE_MAX) {
    if (onAction) {
      return (
        <button
          type="button"
          className={`${className} hover:text-primary hover:underline text-left break-words`}
          onClick={onAction}
        >
          {trimmed}
        </button>
      );
    }
    return <span className={`${className} break-words`}>{trimmed}</span>;
  }

  const preview = `${trimmed.slice(0, LOG_DETAIL_INLINE_MAX).trim()}…`;

  return (
    <span className={`${className} inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0`}>
      <span className="break-words">{preview}</span>
      <button
        type="button"
        className="shrink-0 text-[10px] text-primary hover:underline"
        onClick={() => toast.message(title, { description: trimmed, duration: 10_000 })}
      >
        Xem đủ
      </button>
      {onAction ? (
        <button
          type="button"
          className="shrink-0 text-[10px] text-muted-foreground hover:underline"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </span>
  );
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
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadGenRef = useRef(0);
  const [searchTerm, setSearchTerm] = useState(() => params.get('search') ?? '');
  const [kindFilter, setKindFilter] = useState<KindFilter>(() => {
    const k = params.get('kind');
    if (k === 'admin' || k === 'traffic') return k;
    const r = params.get('result');
    if (r === 'success' || r === 'failure') return 'traffic';
    return 'all';
  });
  const [methodFilter, setMethodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState(() => {
    const r = params.get('result');
    if (r === 'success' || r === 'failure') return r;
    return 'all';
  });
  const [reasonFilter, setReasonFilter] = useState(() => params.get('reason') ?? 'all');
  const [clientKeyFilter, setClientKeyFilter] = useState<number | null>(() => {
    const raw = params.get('client_key_id');
    if (!raw || !/^\d+$/.test(raw)) return null;
    return Number(raw);
  });

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
    const gen = ++loadGenRef.current;
    setRefreshing(true);
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
              reason: reasonFilter,
              client_key_id: clientKeyFilter ?? undefined,
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

      if (gen !== loadGenRef.current) return;
      setEntries(mergeLogs(traffic, admin));
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      toastApiError(e);
    } finally {
      if (gen === loadGenRef.current) {
        setRefreshing(false);
        setInitialLoading(false);
      }
    }
  }, [
    showTraffic,
    showAdmin,
    effectiveKind,
    methodFilter,
    statusFilter,
    resultFilter,
    searchTerm,
    reasonFilter,
    clientKeyFilter,
  ]);

  useEffect(() => {
    const t = setTimeout(() => void load(), searchTerm ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, searchTerm]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (effectiveKind !== 'all') next.set('kind', effectiveKind);
    if (reasonFilter !== 'all') next.set('reason', reasonFilter);
    if (searchTerm.trim()) next.set('search', searchTerm.trim());
    if (clientKeyFilter != null) next.set('client_key_id', String(clientKeyFilter));
    if (resultFilter !== 'all') next.set('result', resultFilter);
    const nextStr = next.toString();
    if (nextStr !== params.toString()) {
      setParams(next, { replace: true });
    }
  }, [effectiveKind, reasonFilter, searchTerm, clientKeyFilter, resultFilter, params, setParams]);

  const showMethodStatusFilters =
    showTraffic && (effectiveKind === 'all' || effectiveKind === 'traffic');
  const showResultFilter =
    (showTraffic && (effectiveKind === 'all' || effectiveKind === 'traffic')) ||
    (showAdmin && (effectiveKind === 'all' || effectiveKind === 'admin'));

  const trafficCount = entries.filter((e) => e.kind === 'traffic').length;
  const adminCount = entries.filter((e) => e.kind === 'admin').length;

  return (
    <>
      <div className="mb-6 sm:mb-8">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
          Observability
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Log vận hành</h1>
      </div>

      <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-0 scroll-mt-24 min-w-0" id="section-logs">
        <div className="sticky top-0 z-30 isolate rounded-t-2xl bg-card shadow-[0_12px_28px_-14px_rgba(0,0,0,0.65)]">
          <div className="p-4 sm:p-6 space-y-4 border-b border-border/80 bg-card/98 backdrop-blur-md">
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
                  <SelectItem value="2xx">2xx — OK (200–299)</SelectItem>
                  <SelectItem value="4xx">4xx — Lỗi client (401, 404…)</SelectItem>
                  <SelectItem value="5xx">5xx — Lỗi server (502, 504…)</SelectItem>
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

          {showMethodStatusFilters ? (
            <Select value={reasonFilter} onValueChange={setReasonFilter}>
              <SelectTrigger className="w-[200px] bg-input border-border">
                <SelectValue placeholder="Middleware reason" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border max-h-72">
                {MIDDLEWARE_REASON_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Button
            variant="outline"
            className="border-border"
            onClick={() => void load()}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
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

        {!initialLoading && effectiveKind === 'all' && showTraffic && showAdmin ? (
          <p className="text-xs text-muted-foreground">
            Hiển thị {entries.length} sự kiện gần nhất — {trafficCount} traffic, {adminCount}{' '}
            quản trị
            {resultFilter !== 'all'
              ? ` · lọc kết quả: ${resultFilter === 'success' ? 'thành công' : 'thất bại'} (traffic: outcome; audit: result)`
              : ''}
          </p>
        ) : !initialLoading && resultFilter !== 'all' ? (
          <p className="text-xs text-muted-foreground">
            Lọc kết quả: {resultFilter === 'success' ? 'thành công' : 'thất bại'} — traffic theo{' '}
            <code className="text-slate-400">outcome</code>, audit theo{' '}
            <code className="text-slate-400">result</code>. HTTP 200 chỉ hiện khi thành công.
          </p>
        ) : null}
        {showMethodStatusFilters && statusFilter !== 'all' ? (
          <p className="text-xs text-muted-foreground">
            Lọc HTTP: {HTTP_STATUS_FILTER_HINT[statusFilter]}
          </p>
        ) : showMethodStatusFilters ? (
          <p className="text-xs text-muted-foreground">
            HTTP: <strong className="text-slate-300">2xx</strong> = OK ·{' '}
            <strong className="text-slate-300">4xx</strong> = client (401/404/429) ·{' '}
            <strong className="text-slate-300">5xx</strong> = upstream/server
          </p>
        ) : null}
        {clientKeyFilter != null ? (
          <p className="text-xs text-cyan-400/90 flex flex-wrap items-center gap-2">
            Lọc client #{clientKeyFilter}
            <Link to={`/auth?open=${clientKeyFilter}`} className="text-primary hover:underline">
              Mở registry
            </Link>
            <button
              type="button"
              className="text-muted-foreground hover:underline"
              onClick={() => setClientKeyFilter(null)}
            >
              Bỏ lọc
            </button>
          </p>
        ) : null}
          </div>
          <LogColumnHeader />
        </div>

        <div className="relative text-sm min-h-[12rem]">
          {refreshing && entries.length > 0 ? (
            <div
              className="absolute inset-0 z-10 flex items-start justify-center pt-20 pointer-events-none bg-slate-950/25"
              aria-hidden
            >
              <RefreshCw className="w-5 h-5 animate-spin text-primary/80" />
            </div>
          ) : null}
          {initialLoading && entries.length === 0 ? (
            <p className="px-6 py-10 text-center text-muted-foreground">Đang tải…</p>
          ) : entries.length === 0 ? (
            <p className="px-6 py-10 text-center text-muted-foreground">
              Không có bản ghi — thử đổi bộ lọc hoặc thực hiện thao tác / gọi API.
            </p>
          ) : (
            <div className={refreshing ? 'opacity-60 transition-opacity duration-150' : 'transition-opacity duration-150'}>
            {entries.map((entry) => {
              if (entry.kind === 'traffic') {
                const log = entry.row;
                return (
                  <div
                    key={`t-${log.id}`}
                    className={`${LOG_GRID} border-b border-border/50 hover:bg-primary/5`}
                  >
                    <div className={LOG_CELL}>
                      <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/25 border text-[10px]">
                        Traffic
                      </Badge>
                    </div>
                    <div className={LOG_CELL}>
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
                    </div>
                    <div className={`${LOG_CELL} text-slate-400 font-mono text-xs whitespace-nowrap`}>
                      {formatDbTimestamp(log.created_at)}
                    </div>
                    <div className={`${LOG_CELL} hidden sm:block text-xs text-slate-400 min-w-0`}>
                      <p className="break-words">
                        {log.duration_ms}ms
                        {log.api_key_masked ? (
                          <>
                            {' · '}
                            <button
                              type="button"
                              className="font-mono text-sky-400 hover:underline"
                              title="Lọc theo API key"
                              onClick={() => setSearchTerm(log.api_key_masked ?? '')}
                            >
                              {log.api_key_masked}
                            </button>
                            {log.client_key_id ? (
                              <>
                                {' · '}
                                <Link
                                  to={`/auth?open=${log.client_key_id}`}
                                  className="text-primary hover:underline"
                                >
                                  client #{log.client_key_id}
                                </Link>
                              </>
                            ) : null}
                          </>
                        ) : null}
                      </p>
                      {log.reason ? (
                        <p className="mt-0.5">
                          <LogDetailText
                            text={reasonLabel(log.reason)}
                            title="Lý do middleware"
                            className="text-[10px] text-slate-500"
                            onAction={() => setReasonFilter(log.reason)}
                          />
                        </p>
                      ) : null}
                    </div>
                    <div
                      className={`${LOG_CELL} hidden sm:block font-mono text-xs text-slate-500 whitespace-nowrap`}
                    >
                      {log.client_ip ?? '—'}
                    </div>
                    <div className={LOG_CELL}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge className={`${getStatusBadgeClass(log.status)} border font-mono`}>
                          {log.status}
                        </Badge>
                        <MiddlewareStageBadge
                          status={log.status}
                          reason={log.reason}
                          outcome={log.outcome}
                        />
                      </div>
                      {log.outcome !== 'success' ? (
                        <p className="text-[10px] text-red-400/90 mt-0.5 font-mono">{log.outcome}</p>
                      ) : null}
                    </div>
                  </div>
                );
              }

              const log = entry.row;
              return (
                <div
                  key={`a-${log.id}`}
                  className={`${LOG_GRID} border-b border-border/50 hover:bg-primary/5`}
                >
                  <div className={LOG_CELL}>
                    <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/25 border text-[10px]">
                      Quản trị
                    </Badge>
                  </div>
                  <div className={LOG_CELL}>
                    <p className="font-mono text-xs text-primary">{log.action}</p>
                    <p className="text-xs text-slate-400 truncate max-w-[14rem]">{log.resource}</p>
                  </div>
                  <div className={`${LOG_CELL} text-slate-400 font-mono text-xs whitespace-nowrap`}>
                    {formatDbTimestamp(log.created_at)}
                  </div>
                  <div className={`${LOG_CELL} hidden sm:block text-xs text-slate-400 min-w-0`}>
                    <p className="break-words">
                      {log.actor}
                      <span className="text-muted-foreground"> · {log.role}</span>
                    </p>
                    {log.details ? (
                      <p className="mt-0.5">
                        <LogDetailText text={log.details} title="Chi tiết thao tác" />
                      </p>
                    ) : null}
                  </div>
                  <div
                    className={`${LOG_CELL} hidden sm:block font-mono text-xs text-slate-500 whitespace-nowrap`}
                  >
                    {log.source_ip ?? '—'}
                  </div>
                  <div className={LOG_CELL}>
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
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
