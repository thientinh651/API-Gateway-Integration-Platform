import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Download, Search, CheckCircle2, XCircle, CalendarDays, X } from 'lucide-react';
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
import { fetchAuditLogs, type AuditLogRow } from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
import {
  dbDayKey,
  formatDbDayLabel,
  formatDbTimestamp,
  formatDbTimestampForExport,
} from '../../../lib/formatDbTimestamp';
import { formatAuditDetails } from '../../../lib/formatAuditDetails';

function exportCsv(rows: AuditLogRow[]) {
  const header = ['created_at', 'actor', 'role', 'action', 'resource', 'result', 'source_ip', 'details'];
  const lines = rows.map((r) => [
    formatDbTimestampForExport(r.created_at),
    r.actor,
    r.role,
    r.action,
    r.resource,
    r.result,
    r.source_ip ?? '',
    r.details ?? '',
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `log-quan-tri-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const GRID = 'grid w-full min-w-0 grid-cols-[26%_14%_24%_13%_13%] items-center';
const CELL = 'px-4 sm:px-6 py-3 min-w-0';
const HEAD = 'text-[10px] uppercase text-muted-foreground font-bold whitespace-nowrap bg-slate-950';

export function AdminAuditPanel() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadGenRef = useRef(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'success' | 'failure'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setRefreshing(true);
    try {
      const data = await fetchAuditLogs({
        limit: 200,
        result: resultFilter,
        search: searchTerm,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
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
  }, [resultFilter, searchTerm, dateFrom, dateTo]);

  const groupedByDay = useMemo(() => {
    const out: { key: string; label: string; rows: AuditLogRow[] }[] = [];
    for (const log of rows) {
      const key = dbDayKey(log.created_at) ?? 'unknown';
      const last = out[out.length - 1];
      if (last && last.key === key) {
        last.rows.push(log);
      } else {
        out.push({ key, label: formatDbDayLabel(log.created_at), rows: [log] });
      }
    }
    return out;
  }, [rows]);

  useEffect(() => {
    const t = setTimeout(() => void load(), searchTerm ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, searchTerm]);

  return (
    <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-0 min-w-0">
      <div className="sticky top-0 z-30 isolate rounded-t-2xl bg-card shadow-[0_12px_28px_-14px_rgba(0,0,0,0.65)]">
        <div className="p-4 sm:p-6 space-y-4 border-b border-border/80 bg-card/98 backdrop-blur-md">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Tìm user, action, resource, IP…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-input border-border text-foreground"
              />
            </div>
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
            <Button variant="outline" className="border-border" onClick={() => exportCsv(rows)} disabled={rows.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              Xuất CSV
            </Button>
          </div>
        </div>

        <div className={`${GRID} border-b border-slate-700/60 bg-slate-950`}>
          <div className={`${CELL} ${HEAD}`}>Thao tác</div>
          <div className={`${CELL} ${HEAD}`}>Thời gian</div>
          <div className={`${CELL} ${HEAD} hidden sm:block`}>Chi tiết</div>
          <div className={`${CELL} ${HEAD} hidden sm:block`}>IP</div>
          <div className={`${CELL} ${HEAD}`}>Kết quả</div>
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
          <p className="px-6 py-10 text-center text-muted-foreground">Chưa có log quản trị.</p>
        ) : (
          <div className={refreshing ? 'opacity-60 transition-opacity duration-150' : 'transition-opacity duration-150'}>
            {groupedByDay.map((group, gi) => (
              <div key={group.key} className={gi === 0 ? '' : 'mt-5'}>
                <div className="flex items-center gap-2 px-4 sm:px-6 py-2 border-y border-border/60 bg-slate-950/70">
                  <CalendarDays className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-xs font-bold text-primary capitalize">{group.label}</span>
                  <span className="text-[10px] text-muted-foreground">· {group.rows.length} bản ghi</span>
                </div>
                {group.rows.map((log) => {
                  const detailText = formatAuditDetails(log.details, log.action);
                  return (
                    <div key={log.id} className={`${GRID} border-b border-border/50 hover:bg-primary/5`}>
                      <div className={CELL}>
                        <p className="font-mono text-xs text-primary break-words">{log.action}</p>
                        <p className="text-xs text-slate-400 truncate max-w-[16rem]">{log.resource}</p>
                      </div>
                      <div className={`${CELL} text-slate-400 font-mono text-xs whitespace-nowrap`}>
                        {formatDbTimestamp(log.created_at)}
                      </div>
                      <div className={`${CELL} hidden sm:block text-xs text-slate-400 min-w-0`}>
                        <p className="break-words">
                          {log.actor}
                          <span className="text-muted-foreground"> · {log.role}</span>
                        </p>
                        {detailText ? (
                          <p className="mt-0.5 text-slate-500 break-words">{detailText}</p>
                        ) : null}
                      </div>
                      <div className={`${CELL} hidden sm:block font-mono text-xs text-slate-500 whitespace-nowrap`}>
                        {log.source_ip ?? '—'}
                      </div>
                      <div className={CELL}>
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
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
