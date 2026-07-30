import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Download, Search, Eye, Copy, CalendarDays, X } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet';
import { fetchSyncLogs, type SyncLogRow } from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
import {
  dbDayKey,
  formatDbDayLabel,
  formatDbTimestamp,
  formatDbTimestampForExport,
} from '../../../lib/formatDbTimestamp';
import { prettyMaybeJson } from './logsShared';

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'SUCCESS':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'FAILED':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'SKIPPED':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'RETRY':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    default:
      return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  }
}

function exportCsv(rows: SyncLogRow[]) {
  const header = [
    'created_at',
    'status',
    'event_type',
    'flow_type',
    'source_provider',
    'target_provider',
    'correlation_id',
    'message',
    'error_detail',
    'metadata_json',
  ];
  const lines = rows.map((r) => [
    formatDbTimestampForExport(r.created_at),
    r.status,
    r.event_type ?? '',
    r.flow_type ?? '',
    r.source_provider ?? '',
    r.target_provider ?? '',
    r.correlation_id ?? '',
    r.message,
    r.error_detail ?? '',
    r.metadata_json ?? '',
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `log-tich-hop-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function copyText(label: string, text: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`Đã copy ${label}`))
    .catch(() => toast.error('Không copy được'));
}

function IntegrationDetailSheet({
  log,
  open,
  onOpenChange,
}: {
  log: SyncLogRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const meta = prettyMaybeJson(log?.metadata_json);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-white">Chi tiết sự kiện tích hợp</SheetTitle>
          <SheetDescription>
            {log?.correlation_id ? <span className="font-mono text-[11px]">trace {log.correlation_id}</span> : 'Salesforce → Zoho'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-auto px-4 pb-6 space-y-5">
          {!log ? (
            <p className="py-16 text-center text-muted-foreground">Không có dữ liệu.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Badge className={`${statusBadgeClass(log.status)} border`}>{log.status}</Badge>
                {log.event_type ? (
                  <Badge className="bg-primary/10 text-primary border-primary/20 border text-[10px] font-mono">
                    {log.event_type}
                  </Badge>
                ) : null}
              </div>
              <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Flow</dt>
                <dd className="text-slate-300 font-mono">{log.flow_type ?? '—'}</dd>
                <dt className="text-muted-foreground">Nguồn → Đích</dt>
                <dd className="text-slate-300 font-mono">
                  {(log.source_provider ?? '—')} → {(log.target_provider ?? '—')}
                </dd>
                <dt className="text-muted-foreground">Correlation</dt>
                <dd className="text-slate-300 font-mono break-all">{log.correlation_id ?? '—'}</dd>
                <dt className="text-muted-foreground">Thời gian</dt>
                <dd className="text-slate-300">{formatDbTimestamp(log.created_at)}</dd>
              </dl>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Message</p>
                <p className="text-sm text-slate-200 leading-relaxed">{log.message}</p>
              </div>
              {log.error_detail ? (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Lỗi</p>
                  <pre className="rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-[11px] text-red-300 overflow-auto max-h-48 whitespace-pre-wrap break-words">
                    {log.error_detail}
                  </pre>
                </div>
              ) : null}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Data</p>
                  {meta ? (
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                      onClick={() => copyText('metadata', log.metadata_json ?? '')}
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                  ) : null}
                </div>
                {meta ? (
                  <pre className="rounded-lg border border-border bg-slate-950/50 p-3 text-[11px] text-slate-300 overflow-auto max-h-80 whitespace-pre-wrap break-words">
                    {meta}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Không có dữ liệu</p>
                )}
              </div>
            </>
          )}
        </div>
        <div className="border-t border-border p-3 flex justify-end">
          <Button variant="outline" size="sm" className="border-border" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const GRID = 'grid w-full min-w-0 grid-cols-[12%_18%_34%_15%_13%_8%] items-center';
const CELL = 'px-4 sm:px-6 py-3 min-w-0';
const HEAD = 'text-[10px] uppercase text-muted-foreground font-bold whitespace-nowrap bg-slate-950';

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type QuickRange = { id: string; label: string; days: number | null };
const QUICK_RANGES: QuickRange[] = [
  { id: 'today', label: 'Hôm nay', days: 0 },
  { id: '7d', label: '7 ngày', days: 6 },
  { id: '30d', label: '30 ngày', days: 29 },
  { id: 'all', label: 'Tất cả', days: null },
];

export function IntegrationLogPanel() {
  const [rows, setRows] = useState<SyncLogRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadGenRef = useRef(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [detailLog, setDetailLog] = useState<SyncLogRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setRefreshing(true);
    try {
      const data = await fetchSyncLogs();
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyQuickRange = useCallback((r: QuickRange) => {
    if (r.days == null) {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const today = new Date();
    const from = new Date();
    from.setDate(today.getDate() - r.days);
    setDateFrom(ymdLocal(from));
    setDateTo(ymdLocal(today));
  }, []);

  const activeQuickRange = useMemo(() => {
    if (!dateFrom && !dateTo) return 'all';
    const today = ymdLocal(new Date());
    if (dateTo !== today) return null;
    for (const r of QUICK_RANGES) {
      if (r.days == null) continue;
      const from = new Date();
      from.setDate(new Date().getDate() - r.days);
      if (dateFrom === ymdLocal(from)) return r.id;
    }
    return null;
  }, [dateFrom, dateTo]);

  const q = searchTerm.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (dateFrom || dateTo) {
      const key = dbDayKey(r.created_at);
      if (!key) return false;
      if (dateFrom && key < dateFrom) return false;
      if (dateTo && key > dateTo) return false;
    }
    if (!q) return true;
    return (
      r.message.toLowerCase().includes(q) ||
      (r.event_type ?? '').toLowerCase().includes(q) ||
      (r.correlation_id ?? '').toLowerCase().includes(q) ||
      (r.error_detail ?? '').toLowerCase().includes(q) ||
      (r.metadata_json ?? '').toLowerCase().includes(q)
    );
  });

  const groupedByDay = useMemo(() => {
    const out: { key: string; label: string; rows: SyncLogRow[] }[] = [];
    for (const log of filtered) {
      const key = dbDayKey(log.created_at) ?? 'unknown';
      const last = out[out.length - 1];
      if (last && last.key === key) {
        last.rows.push(log);
      } else {
        out.push({ key, label: formatDbDayLabel(log.created_at), rows: [log] });
      }
    }
    return out;
  }, [filtered]);

  const openDetail = (log: SyncLogRow) => {
    setDetailLog(log);
    setDetailOpen(true);
  };

  return (
    <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-0 min-w-0">
      <div className="sticky top-0 z-30 isolate rounded-t-2xl bg-card shadow-[0_12px_28px_-14px_rgba(0,0,0,0.65)]">
        <div className="p-4 sm:p-6 space-y-4 border-b border-border/80 bg-card/98 backdrop-blur-md">
          <p className="text-xs text-muted-foreground">
            Chi tiết pipeline tích hợp Salesforce → Zoho: từng bước sync, kết quả, thời gian, metadata đầy đủ.
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Tìm message, event, trace, metadata…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-input border-border text-foreground"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px] bg-input border-border">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">Mọi trạng thái</SelectItem>
                <SelectItem value="SUCCESS">SUCCESS</SelectItem>
                <SelectItem value="FAILED">FAILED</SelectItem>
                <SelectItem value="SKIPPED">SKIPPED</SelectItem>
                <SelectItem value="RETRY">RETRY</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-input px-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="Từ ngày"
                className="bg-transparent text-sm text-foreground outline-none py-2 [color-scheme:dark]"
              />
              <span className="text-muted-foreground text-xs">→</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="Đến ngày"
                className="bg-transparent text-sm text-foreground outline-none py-2 [color-scheme:dark]"
              />
              {dateFrom || dateTo ? (
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="text-muted-foreground hover:text-primary shrink-0"
                  aria-label="Xóa lọc ngày"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>
            <Button variant="outline" className="border-border" onClick={() => void load()} disabled={refreshing}>
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Làm mới
            </Button>
            <Button variant="outline" className="border-border" onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              Xuất CSV
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => applyQuickRange(r)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  activeQuickRange === r.id
                    ? 'border-primary/60 bg-primary/15 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`${GRID} border-b border-slate-700/60 bg-slate-950`}>
          <div className={`${CELL} ${HEAD}`}>Trạng thái</div>
          <div className={`${CELL} ${HEAD}`}>Sự kiện</div>
          <div className={`${CELL} ${HEAD}`}>Message</div>
          <div className={`${CELL} ${HEAD} hidden sm:block`}>Nguồn → Đích</div>
          <div className={`${CELL} ${HEAD}`}>Thời gian</div>
          <div className={`${CELL} ${HEAD} text-right`}>Chi tiết</div>
        </div>
      </div>

      <div className="relative text-sm min-h-[12rem]">
        {refreshing && filtered.length > 0 ? (
          <div className="absolute inset-0 z-10 flex items-start justify-center pt-20 pointer-events-none bg-slate-950/25" aria-hidden>
            <RefreshCw className="w-5 h-5 animate-spin text-primary/80" />
          </div>
        ) : null}
        {initialLoading && rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-muted-foreground">Đang tải…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-muted-foreground">
            Chưa có log tích hợp — chạy Sync Now trong trang Tích hợp.
          </p>
        ) : (
          <div className={refreshing ? 'opacity-60 transition-opacity duration-150' : 'transition-opacity duration-150'}>
            {groupedByDay.map((group, gi) => (
              <div key={group.key} className={gi === 0 ? '' : 'mt-5'}>
                <div className="flex items-center gap-2 px-4 sm:px-6 py-2 border-y border-border/60 bg-slate-950/70">
                  <CalendarDays className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-xs font-bold text-primary capitalize">{group.label}</span>
                  <span className="text-[10px] text-muted-foreground">· {group.rows.length} bản ghi</span>
                </div>
                {group.rows.map((log) => (
                  <div key={log.id} className={`${GRID} border-b border-border/50 hover:bg-primary/5`}>
                    <div className={CELL}>
                      <Badge className={`${statusBadgeClass(log.status)} border text-[10px]`}>{log.status}</Badge>
                    </div>
                    <div className={CELL}>
                      {log.event_type ? (
                        <Badge className="bg-primary/10 text-primary border-primary/20 border text-[10px] font-mono truncate max-w-full">
                          {log.event_type}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                      {log.correlation_id ? (
                        <p className="text-[10px] text-muted-foreground font-mono mt-1 truncate" title={log.correlation_id}>
                          trace {log.correlation_id.slice(0, 8)}
                        </p>
                      ) : null}
                    </div>
                    <div className={`${CELL} min-w-0`}>
                      <p className="text-xs text-slate-200 truncate">{log.message}</p>
                      {log.error_detail ? (
                        <p className="text-[10px] text-red-400/90 font-mono truncate mt-0.5">{log.error_detail}</p>
                      ) : null}
                    </div>
                    <div className={`${CELL} hidden sm:block text-[11px] text-slate-400 font-mono min-w-0`}>
                      <span className="truncate block">
                        {(log.source_provider ?? '—')} → {(log.target_provider ?? '—')}
                      </span>
                    </div>
                    <div className={`${CELL} text-slate-400 font-mono text-xs whitespace-nowrap`}>
                      {formatDbTimestamp(log.created_at)}
                    </div>
                    <div className={`${CELL} text-right`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-border h-7 px-2 text-[11px]"
                        onClick={() => openDetail(log)}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        Xem
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <IntegrationDetailSheet log={detailLog} open={detailOpen} onOpenChange={setDetailOpen} />
    </Card>
  );
}
