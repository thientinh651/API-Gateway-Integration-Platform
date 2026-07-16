import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { RefreshCw, Download, Search, Eye } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  fetchClientKeys,
  fetchTransactionLogs,
  type TransactionLogRow,
} from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
import { formatDbTimestamp, formatDbTimestampForExport } from '../../../lib/formatDbTimestamp';
import { reasonLabel, MIDDLEWARE_REASON_FILTER_OPTIONS } from '../../../lib/middlewareLabels';
import { MiddlewareStageBadge } from '../../components/auth/MiddlewareStageBadge';
import { getMethodColor, getStatusBadgeClass, HTTP_STATUS_FILTER_HINT } from './logsShared';
import { TransactionDetailSheet } from './TransactionDetailSheet';

type Props = {
  clientKeyFilter: number | null;
  onClearClientKey: () => void;
};

function exportCsv(rows: TransactionLogRow[]) {
  const header = [
    'created_at',
    'method',
    'path',
    'status',
    'duration_ms',
    'ip',
    'outcome',
    'middleware_reason',
    'client_key_id',
    'client_name',
    'upstream',
    'request_id',
  ];
  const lines = rows.map((r) => [
    formatDbTimestampForExport(r.created_at),
    r.method,
    r.path,
    String(r.status),
    String(r.duration_ms),
    r.client_ip ?? '',
    r.outcome,
    reasonLabel(r.reason),
    r.client_key_id != null ? String(r.client_key_id) : '',
    r.client_name ?? '',
    r.upstream ?? '',
    r.request_id,
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `log-route-traffic-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const GRID = 'grid w-full min-w-0 grid-cols-[26%_13%_20%_13%_15%_13%] items-center';
const CELL = 'px-4 sm:px-6 py-3 min-w-0';
const HEAD = 'text-[10px] uppercase text-muted-foreground font-bold whitespace-nowrap bg-slate-950';

export function TrafficLogPanel({ clientKeyFilter, onClearClientKey }: Props) {
  const [rows, setRows] = useState<TransactionLogRow[]>([]);
  const [clientNames, setClientNames] = useState<Map<number, string>>(() => new Map());
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadGenRef = useRef(0);

  const [searchTerm, setSearchTerm] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | '2xx' | '4xx' | '5xx'>('all');
  const [resultFilter, setResultFilter] = useState<'all' | 'success' | 'failure'>('all');
  const [reasonFilter, setReasonFilter] = useState('all');

  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchClientKeys()
      .then((keys) => {
        if (cancelled) return;
        setClientNames(new Map(keys.map((k) => [k.id, k.name])));
      })
      .catch(() => {
        /* giữ fallback Client #id */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clientLabel = (log: TransactionLogRow) => {
    if (log.client_key_id == null) return null;
    const fromRegistry = clientNames.get(log.client_key_id)?.trim();
    const fromApi = log.client_name?.trim();
    return fromRegistry || fromApi || `Client #${log.client_key_id}`;
  };

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setRefreshing(true);
    try {
      const data = await fetchTransactionLogs({
        limit: 200,
        method: methodFilter,
        status: statusFilter,
        outcome: resultFilter === 'all' ? undefined : resultFilter,
        search: searchTerm,
        reason: reasonFilter,
        client_key_id: clientKeyFilter ?? undefined,
      });
      if (gen !== loadGenRef.current) return;
      setRows(data);
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      toastApiError(e);
    } finally {
      if (gen === loadGenRef.current) {
        setRefreshing(false);
        setInitialLoading(false);
      }
    }
  }, [methodFilter, statusFilter, resultFilter, searchTerm, reasonFilter, clientKeyFilter]);

  useEffect(() => {
    const t = setTimeout(() => void load(), searchTerm ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, searchTerm]);

  const openDetail = (id: number) => {
    setDetailId(id);
    setDetailOpen(true);
  };

  return (
    <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-0 min-w-0">
      <div className="sticky top-0 z-30 isolate rounded-t-2xl bg-card shadow-[0_12px_28px_-14px_rgba(0,0,0,0.65)]">
        <div className="p-4 sm:p-6 space-y-4 border-b border-border/80 bg-card/98 backdrop-blur-md">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Tìm path, IP, request ID, API key…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-input border-border text-foreground"
              />
            </div>
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
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
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
            <Select value={resultFilter} onValueChange={(v) => setResultFilter(v as typeof resultFilter)}>
              <SelectTrigger className="w-[140px] bg-input border-border">
                <SelectValue placeholder="Kết quả" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">Mọi kết quả</SelectItem>
                <SelectItem value="success">Thành công</SelectItem>
                <SelectItem value="failure">Thất bại</SelectItem>
              </SelectContent>
            </Select>
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
            <Button variant="outline" className="border-border" onClick={() => void load()} disabled={refreshing}>
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Làm mới
            </Button>
            <Button variant="outline" className="border-border" onClick={() => exportCsv(rows)} disabled={rows.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              Xuất CSV
            </Button>
          </div>

          {statusFilter !== 'all' ? (
            <p className="text-xs text-muted-foreground">Lọc HTTP: {HTTP_STATUS_FILTER_HINT[statusFilter]}</p>
          ) : null}
          {clientKeyFilter != null ? (
            <p className="text-xs text-cyan-400/90 flex flex-wrap items-center gap-2">
              Lọc client #{clientKeyFilter}
              <Link to={`/auth?open=${clientKeyFilter}`} className="text-primary hover:underline">
                Mở registry
              </Link>
              <button type="button" className="text-muted-foreground hover:underline" onClick={onClearClientKey}>
                Bỏ lọc
              </button>
            </p>
          ) : null}
        </div>

        <div className={`${GRID} border-b border-slate-700/60 bg-slate-950`}>
          <div className={`${CELL} ${HEAD}`}>Route / Request</div>
          <div className={`${CELL} ${HEAD}`}>Thời gian</div>
          <div className={`${CELL} ${HEAD} hidden sm:block`}>Client / Upstream</div>
          <div className={`${CELL} ${HEAD} hidden sm:block`}>IP</div>
          <div className={`${CELL} ${HEAD}`}>Kết quả</div>
          <div className={`${CELL} ${HEAD} text-right`}>Chi tiết</div>
        </div>
      </div>

      <div className="relative text-sm min-h-[12rem]">
        {refreshing && rows.length > 0 ? (
          <div className="absolute inset-0 z-10 flex items-start justify-center pt-20 pointer-events-none bg-slate-950/25" aria-hidden>
            <RefreshCw className="w-5 h-5 animate-spin text-primary/80" />
          </div>
        ) : null}
        {initialLoading && rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-muted-foreground">Đang tải…</p>
        ) : rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-muted-foreground">
            Không có bản ghi — thử đổi bộ lọc hoặc gọi API qua route.
          </p>
        ) : (
          <div className={refreshing ? 'opacity-60 transition-opacity duration-150' : 'transition-opacity duration-150'}>
            {rows.map((log) => (
              <div key={log.id} className={`${GRID} border-b border-border/50 hover:bg-primary/5`}>
                <div className={CELL}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={`${getMethodColor(log.method)} border font-mono text-[10px]`}>{log.method}</Badge>
                    <span className="font-mono text-xs text-slate-300 truncate max-w-[16rem]">{log.path}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">{log.request_id}</p>
                </div>
                <div className={`${CELL} text-slate-400 font-mono text-xs whitespace-nowrap`}>
                  {formatDbTimestamp(log.created_at)}
                  <span className="block text-[10px] text-slate-500">{log.duration_ms}ms</span>
                </div>
                <div className={`${CELL} hidden sm:block text-xs text-slate-400 min-w-0`}>
                  {log.client_key_id != null ? (
                    <p className="truncate">
                      <Link
                        to={`/auth?open=${log.client_key_id}`}
                        className="text-sky-400 hover:underline font-medium"
                        title={log.api_key_masked ?? undefined}
                      >
                        {clientLabel(log)}
                      </Link>
                    </p>
                  ) : (
                    <p className="text-slate-500">—</p>
                  )}
                  <p className="text-[10px] text-slate-500 truncate mt-0.5" title={log.upstream ?? undefined}>
                    {log.upstream ?? '—'}
                  </p>
                </div>
                <div className={`${CELL} hidden sm:block font-mono text-xs text-slate-500 whitespace-nowrap`}>
                  {log.client_ip ?? '—'}
                </div>
                <div className={CELL}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge className={`${getStatusBadgeClass(log.status)} border font-mono`}>{log.status}</Badge>
                    <MiddlewareStageBadge status={log.status} reason={log.reason} outcome={log.outcome} />
                  </div>
                  {log.outcome !== 'success' ? (
                    <p className="text-[10px] text-red-400/90 mt-0.5 font-mono">{log.outcome}</p>
                  ) : null}
                </div>
                <div className={`${CELL} text-right`}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border h-7 px-2 text-[11px]"
                    onClick={() => openDetail(log.id)}
                  >
                    <Eye className="w-3.5 h-3.5 mr-1" />
                    Xem
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <TransactionDetailSheet logId={detailId} open={detailOpen} onOpenChange={setDetailOpen} />
    </Card>
  );
}
