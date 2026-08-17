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
  const sorted = [...snapshots]
    .filter((s) => s.entity_type !== 'task')
    .sort((a, b) => {
      const order = (p: IntegrationSnapshotSummary) => (p.provider === 'salesforce' ? 0 : 1);
      return order(a) - order(b) || a.entity_type.localeCompare(b.entity_type);
    });

  const latest =
    sorted.length === 0
      ? null
      : sorted.reduce((a, b) => (a.fetched_at > b.fetched_at ? a : b));

  return (
    <Card className="p-4 sm:p-5 bg-card/80 border-border h-full" id="section-snapshots">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-primary shrink-0" />
            <h3 className="text-sm font-bold text-white">Dữ liệu Salesforce</h3>
          </div>
          <p className="text-[12px] text-muted-foreground mt-1">
            Số bản ghi vừa kéo về sau lần Đồng bộ gần nhất
          </p>
        </div>
        {latest ? (
          <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
            {formatDbTimestamp(latest.fetched_at)}
          </span>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-3">
          Chưa có dữ liệu. Bấm Đồng bộ ngay để kéo từ Salesforce.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-muted-foreground text-[11px]">
              <tr>
                <th className="text-left font-medium py-2 px-3">Hệ thống</th>
                <th className="text-left font-medium py-2 px-3">Loại</th>
                <th className="text-right font-medium py-2 px-3">Số lượng</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr
                  key={`${s.provider}-${s.entity_type}`}
                  className="border-t border-border/60 text-slate-300"
                >
                  <td className="py-2.5 px-3">
                    {s.provider === 'salesforce' ? 'Salesforce' : 'Zoho'}
                  </td>
                  <td className="py-2.5 px-3 text-white">
                    {ENTITY_LABELS[s.entity_type] ?? s.entity_type}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-white">
                    {s.record_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
