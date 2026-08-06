import { Link2 } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import type { EntityLinkRow } from '../../../lib/api';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';

type Props = {
  links: EntityLinkRow[];
};

export function IntegrationEntityLinksPanel({ links }: Props) {
  return (
    <Card className="p-4 sm:p-5 bg-card/80 border-border scroll-mt-24" id="section-entity-links">
      <div className="flex items-center gap-2 mb-4">
        <Link2 className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-bold text-white">Ánh xạ Opportunity ↔ Project</h3>
      </div>
      {links.length === 0 ? (
        <p className="text-xs text-muted-foreground border border-dashed border-border rounded-lg p-4">
          Chưa có link — Sync Now sau khi có Opportunity Closed Won.
        </p>
      ) : (
        <div className="overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs text-left">
            <thead className="text-muted-foreground bg-slate-900/50 border-b border-border">
              <tr>
                <th className="py-2.5 px-3 font-medium">Opportunity</th>
                <th className="py-2.5 px-3 font-medium">Project Zoho</th>
                <th className="py-2.5 px-3 font-medium">Hoàn thành</th>
                <th className="py-2.5 px-3 font-medium">Hóa đơn</th>
                <th className="py-2.5 px-3 font-medium">Sync</th>
              </tr>
            </thead>
            <tbody>
              {links.map((row) => {
                const done = Boolean(row.completion_synced_at);
                const inv = row.invoice_external_id?.trim();
                return (
                  <tr
                    key={`${row.flow_type}-${row.source_id}-${row.target_id}`}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="py-2.5 px-3 font-mono text-slate-300">{row.source_id}</td>
                    <td className="py-2.5 px-3">
                      <div className="text-slate-200">{row.target_display_name ?? '—'}</div>
                      <div className="font-mono text-muted-foreground">{row.target_id}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      {done ? (
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border text-[10px]">
                          Đã báo SF
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-500/10 text-slate-400 border-slate-500/20 border text-[10px]">
                          Chờ
                        </Badge>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {inv ? (
                        <span className="font-mono text-slate-200 break-all">{inv}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                      {formatDbTimestamp(row.last_synced_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
