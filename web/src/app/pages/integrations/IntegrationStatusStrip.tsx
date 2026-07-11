import { CheckCircle2, Circle } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import type { IntegrationRow } from '../../../lib/api';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';

type Props = {
  sf?: IntegrationRow;
  zoho?: IntegrationRow;
};

function ConnectorPill({
  label,
  connected,
  lastSync,
  isDemo,
}: {
  label: string;
  connected: boolean;
  lastSync?: string | null;
  isDemo?: boolean;
}) {
  const Icon = connected ? CheckCircle2 : Circle;
  return (
    <div className="flex items-center gap-3 min-w-0 flex-1">
      <Icon
        className={`w-5 h-5 shrink-0 ${connected ? 'text-emerald-400' : 'text-slate-500'}`}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-white">{label}</span>
          <Badge
            variant="outline"
            className={
              connected
                ? 'text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                : 'text-[10px] bg-slate-500/10 text-slate-400 border-slate-500/25'
            }
          >
            {connected ? 'connected' : 'chưa kết nối'}
          </Badge>
          {isDemo ? (
            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">
              demo
            </Badge>
          ) : null}
        </div>
        {connected && lastSync ? (
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            Sync: {formatDbTimestamp(lastSync)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function IntegrationStatusStrip({ sf, zoho }: Props) {
  const sfConnected = sf?.status === 'connected';
  const zohoConnected = zoho?.status === 'connected';

  return (
    <Card className="p-4 bg-card/50 border-border">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
        <ConnectorPill
          label="Salesforce CRM"
          connected={sfConnected}
          lastSync={sf?.last_sync_at}
          isDemo={sf?.is_demo}
        />
        <div className="hidden sm:block w-px h-10 bg-border shrink-0" aria-hidden />
        <ConnectorPill
          label="Zoho Projects"
          connected={zohoConnected}
          lastSync={zoho?.last_sync_at}
          isDemo={zoho?.is_demo}
        />
      </div>
    </Card>
  );
}
