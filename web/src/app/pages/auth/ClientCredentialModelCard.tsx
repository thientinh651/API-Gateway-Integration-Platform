import { Card } from '../../components/ui/card';
import { ArrowRight, Server } from 'lucide-react';

const FLOW = [
  { from: 'ERP / CRM / Partner', to: 'Middleware Gateway' },
  { from: 'Gateway', to: 'Upstream API' },
];

export function ClientCredentialModelCard() {
  return (
    <Card className="p-5 rounded-2xl bg-card/80 border-border mb-6">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-sky-500/10 shrink-0">
          <Server className="w-5 h-5 text-sky-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-white mb-2">System-to-system — không phải login user</h3>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs text-muted-foreground">
            {FLOW.map((step, i) => (
              <div key={step.from} className="flex items-center gap-2 min-w-0">
                <span className="text-slate-300 font-medium truncate">{step.from}</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0 text-primary" />
                <span className="truncate">{step.to}</span>
                {i < FLOW.length - 1 ? (
                  <ArrowRight className="hidden sm:block w-3.5 h-3.5 text-muted-foreground/40 mx-1" />
                ) : null}
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-[11px] text-slate-400 leading-relaxed list-disc pl-4">
            <li>Tạo credential <strong className="text-slate-300">một lần</strong> — không tạo key mỗi request</li>
            <li>Mỗi HTTP call: POST /oauth/token → Authorization: Bearer JWT</li>
            <li>Admin UI dùng session cookie — khác plane với client data plane</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}
