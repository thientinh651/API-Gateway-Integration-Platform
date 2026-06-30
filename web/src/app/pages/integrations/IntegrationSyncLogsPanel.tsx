import { ScrollText } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import type { SyncLogRow } from '../../../lib/api';

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

type Props = {
  logs: SyncLogRow[];
  emptyHint?: string;
};

export function IntegrationSyncLogsPanel({ logs, emptyHint }: Props) {
  return (
    <Card className="p-4 sm:p-5 bg-card/80 border-border h-full scroll-mt-24" id="section-sync-logs">
      <div className="flex items-center gap-2 mb-4">
        <ScrollText className="w-4 h-4 text-primary" />
        <div>
          <h3 className="text-sm font-bold text-white">Sync Log</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Middleware router + push từng deal</p>
        </div>
      </div>
      {logs.length === 0 ? (
        <p className="text-xs text-muted-foreground border border-dashed border-border rounded-lg p-4">
          {emptyHint ?? 'Chưa có log — bấm Sync Now để chạy pipeline.'}
        </p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-auto pr-1">
          {logs.map((log) => (
            <div
              key={log.id}
              className="text-xs border border-border rounded-lg p-2.5 text-slate-300 flex flex-col gap-1 bg-slate-950/40"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={`${logBadgeClass(log.status)} border text-[10px]`}>{log.status}</Badge>
                <span className="text-muted-foreground">{log.created_at}</span>
              </div>
              <p className="text-slate-200 leading-relaxed">{log.message}</p>
              {log.error_detail ? (
                <p className="text-red-400/90 font-mono break-all text-[11px]">{log.error_detail}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
