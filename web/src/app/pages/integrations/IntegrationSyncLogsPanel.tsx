import { useMemo, useState } from 'react';
import { ChevronDown, ScrollText } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import type { SyncLogRow } from '../../../lib/api';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';
import {
  friendlySyncEventType,
  friendlySyncStatus,
  softenSyncMessage,
} from '../../../lib/syncLogLabels';

const INITIAL = 10;
const STEP = 10;

function logBadgeClass(status: string) {
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

type StatusFilter = 'all' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

type Props = {
  logs: SyncLogRow[];
  emptyHint?: string;
};

function LogRow({ log }: { log: SyncLogRow }) {
  const [open, setOpen] = useState(false);
  const message = softenSyncMessage(log.message);
  const eventLabel = friendlySyncEventType(log.event_type);
  const long = message.length > 110 || Boolean(log.error_detail);

  return (
    <div className="border-b border-border/40 last:border-0">
      <button
        type="button"
        className="w-full text-left px-3 py-2.5 hover:bg-white/[0.02] flex gap-2 items-start"
        onClick={() => long && setOpen((v) => !v)}
        disabled={!long}
      >
        <Badge className={`${logBadgeClass(log.status)} border text-[10px] shrink-0 mt-0.5`}>
          {friendlySyncStatus(log.status)}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
            {eventLabel ? <span className="text-primary/90">{eventLabel}</span> : null}
            <span className="ml-auto whitespace-nowrap">{formatDbTimestamp(log.created_at)}</span>
          </div>
          <p className={`text-[13px] text-slate-200 leading-snug mt-0.5 ${open ? '' : 'line-clamp-2'}`}>
            {message}
          </p>
          {open && log.error_detail ? (
            <p className="text-red-400/90 break-all text-[11px] mt-1">{log.error_detail}</p>
          ) : null}
        </div>
        {long ? (
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
      </button>
    </div>
  );
}

export function IntegrationSyncLogsPanel({ logs, emptyHint }: Props) {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [limit, setLimit] = useState(INITIAL);

  const filtered = useMemo(() => {
    if (status === 'all') return logs;
    return logs.filter((l) => l.status === status);
  }, [logs, status]);

  const visible = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;

  const counts = useMemo(() => {
    let success = 0;
    let failed = 0;
    let skipped = 0;
    for (const l of logs) {
      if (l.status === 'SUCCESS') success += 1;
      else if (l.status === 'FAILED') failed += 1;
      else if (l.status === 'SKIPPED') skipped += 1;
    }
    return { success, failed, skipped, total: logs.length };
  }, [logs]);

  return (
    <Card
      className="p-4 sm:p-5 bg-card/80 border-border h-full scroll-mt-24 flex flex-col"
      id="section-sync-logs"
    >
      <div className="mb-3 flex items-center gap-2">
        <ScrollText className="w-4 h-4 text-primary shrink-0" />
        <h3 className="text-sm font-bold text-white">Lịch sử đồng bộ</h3>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {(
          [
            ['all', `Tất cả (${counts.total})`],
            ['SUCCESS', `Thành công (${counts.success})`],
            ['SKIPPED', `Bỏ qua (${counts.skipped})`],
            ['FAILED', `Lỗi (${counts.failed})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setStatus(key);
              setLimit(INITIAL);
            }}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
              status === key
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-3">
          {emptyHint ?? 'Chưa có lịch sử. Bấm Đồng bộ ngay để chạy lần đầu.'}
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-3">
          Không có mục khớp bộ lọc.
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-border overflow-hidden bg-slate-950/30 max-h-[28rem] overflow-y-auto flex-1">
            {visible.map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>
          {hasMore ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 h-8 text-xs text-muted-foreground"
              onClick={() => setLimit((n) => n + STEP)}
            >
              Xem thêm ({filtered.length - limit} còn lại)
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}
