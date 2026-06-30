import { Link2 } from 'lucide-react';
import { Card } from '../../components/ui/card';
import type { EntityLinkRow } from '../../../lib/api';

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
            Ánh xạ Opportunity Salesforce ↔ Project Zoho — deal đã sync không tạo trùng
          </p>
        </div>
      </div>
      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full text-xs text-left">
          <thead className="text-muted-foreground bg-slate-900/50 border-b border-border">
            <tr>
              <th className="py-2.5 px-3 font-medium">SF Opportunity</th>
              <th className="py-2.5 px-3 font-medium">Zoho Project</th>
              <th className="py-2.5 px-3 font-medium">Lần sync</th>
            </tr>
          </thead>
          <tbody>
            {links.map((row) => (
              <tr key={`${row.sf_id}-${row.zoho_id}`} className="border-b border-border/40 last:border-0">
                <td className="py-2.5 px-3 font-mono text-slate-300">{row.sf_id}</td>
                <td className="py-2.5 px-3 text-slate-200">{row.zoho_name ?? row.zoho_id}</td>
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
