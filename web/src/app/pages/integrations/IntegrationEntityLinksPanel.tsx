import { Link2 } from 'lucide-react';
import { Card } from '../../components/ui/card';
import type { EntityLinkRow } from '../../../lib/api';

function providerLabel(id: string) {
  switch (id) {
    case 'salesforce':
      return 'Salesforce';
    case 'zoho_projects':
      return 'Zoho Projects';
    default:
      return id;
  }
}

type Props = {
  links: EntityLinkRow[];
};

export function IntegrationEntityLinksPanel({ links }: Props) {
  if (links.length === 0) return null;

  return (
    <Card className="p-4 sm:p-5 bg-card/80 border-border scroll-mt-24" id="section-entity-links">
      <div className="flex items-center gap-2 mb-4">
        <Link2 className="w-4 h-4 text-primary" />
        <div>
          <h3 className="text-sm font-bold text-white">Entity links (idempotent)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ánh xạ nguồn → đích theo flow — bản ghi đã sync không tạo trùng
          </p>
        </div>
      </div>
      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full text-xs text-left">
          <thead className="text-muted-foreground bg-slate-900/50 border-b border-border">
            <tr>
              <th className="py-2.5 px-3 font-medium">Flow</th>
              <th className="py-2.5 px-3 font-medium">Nguồn</th>
              <th className="py-2.5 px-3 font-medium">Đích</th>
              <th className="py-2.5 px-3 font-medium">Lần sync</th>
            </tr>
          </thead>
          <tbody>
            {links.map((row) => (
              <tr
                key={`${row.flow_type}-${row.source_id}-${row.target_id}`}
                className="border-b border-border/40 last:border-0"
              >
                <td className="py-2.5 px-3 text-muted-foreground font-mono">{row.flow_type}</td>
                <td className="py-2.5 px-3">
                  <div className="text-slate-400">{providerLabel(row.source_provider)}</div>
                  <div className="font-mono text-slate-300">{row.source_id}</div>
                </td>
                <td className="py-2.5 px-3">
                  <div className="text-slate-400">{providerLabel(row.target_provider)}</div>
                  <div className="text-slate-200">{row.target_name ?? row.target_id}</div>
                </td>
                <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                  {row.last_synced_at}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
