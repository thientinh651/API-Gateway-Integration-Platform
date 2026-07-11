import { Database } from 'lucide-react';
import { Card } from '../../components/ui/card';
import type { IntegrationSnapshotSummary } from '../../../lib/api';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';

const ENTITY_LABELS: Record<string, string> = {
  opportunity: 'Opportunity',
  account: 'Account',
  contact: 'Contact',
  project: 'Project',
  task: 'Task',
};

type Props = {
  snapshots: IntegrationSnapshotSummary[];
};

export function IntegrationSnapshotsPanel({ snapshots }: Props) {
  const sorted = [...snapshots].sort((a, b) => {
    const order = (p: IntegrationSnapshotSummary) =>
      p.provider === 'salesforce' ? 0 : 1;
    return order(a) - order(b) || a.entity_type.localeCompare(b.entity_type);
  });

  return (
    <Card className="p-4 sm:p-5 bg-card/80 border-border h-full" id="section-snapshots">
      <div className="flex items-center gap-2 mb-4">
        <Database className="w-4 h-4 text-primary" />
        <div>
          <h3 className="text-sm font-bold text-white">Snapshot</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Dữ liệu pull qua gateway loopback</p>
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground border border-dashed border-border rounded-lg p-4">
          Chưa có snapshot — Sync Now sẽ pull Salesforce.
        </p>
      ) : (
        <div className="grid gap-2">
          {sorted.map((s) => (
            <div
              key={`${s.provider}-${s.entity_type}`}
              className="flex items-center justify-between gap-3 text-xs border border-border rounded-lg px-3 py-2.5 bg-slate-950/40"
            >
              <div className="min-w-0">
                <span className="font-medium text-white">
                  {s.provider === 'salesforce' ? 'Salesforce' : 'Zoho'}
                </span>
                <span className="text-muted-foreground">
                  {' '}
                  · {ENTITY_LABELS[s.entity_type] ?? s.entity_type}
                </span>
              </div>
              <div className="text-right shrink-0">
                <span className="text-white font-semibold">{s.record_count}</span>
                <span className="text-muted-foreground"> bản ghi</span>
                <p className="text-[10px] text-muted-foreground mt-0.5">{formatDbTimestamp(s.fetched_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
