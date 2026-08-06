import { useState } from 'react';
import { ChevronDown, Cloud, Database, FlaskConical, Plug, Unplug } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDangerButton } from '../../components/forms/ConfirmDangerButton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible';
import type { IntegrationRow } from '../../../lib/api';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';

export type ProviderKind = 'salesforce' | 'zoho_projects';

const META: Record<ProviderKind, { label: string; short: string }> = {
  salesforce: { label: 'Salesforce', short: 'Salesforce CRM' },
  zoho_projects: { label: 'Zoho Projects', short: 'Zoho Projects' },
};

type ConnectedProps = {
  kind: ProviderKind;
  row: IntegrationRow;
  isAdmin: boolean;
  testing: boolean;
  syncing: boolean;
  onDisconnect: () => Promise<void>;
  onTest: () => void;
  onTestProjects?: () => void;
  onTestTasks?: () => void;
  onSyncSnapshot?: () => void;
  onConfigure?: () => void;
};

export function IntegrationConnectorCard({
  kind,
  row,
  isAdmin,
  testing,
  syncing,
  onDisconnect,
  onTest,
  onTestProjects,
  onTestTasks,
  onSyncSnapshot,
  onConfigure,
}: ConnectedProps) {
  const [diagOpen, setDiagOpen] = useState(false);
  const meta = META[kind];

  return (
    <Card
      id={kind === 'salesforce' ? 'section-salesforce' : 'section-zoho'}
      className="p-5 bg-card/80 border-border h-full flex flex-col scroll-mt-24"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <Cloud className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-bold text-white">{meta.short}</h2>
              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border text-[10px]">
                connected
              </Badge>
              {row.is_demo ? (
                <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 border text-[10px]">
                  demo
                </Badge>
              ) : null}
            </div>
            {row.last_sync_at ? (
              <p className="text-xs text-muted-foreground mt-1">
                Sync gần nhất: {formatDbTimestamp(row.last_sync_at)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">OAuth qua gateway proxy</p>
            )}
            {row.last_error && row.status === 'error' ? (
              <p className="text-xs text-red-400 mt-2 break-all">{row.last_error}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-auto space-y-3">
        {isAdmin && onConfigure ? (
          <Button variant="outline" size="sm" className="w-full border-border" onClick={onConfigure}>
            Cấu hình OAuth
          </Button>
        ) : null}
        {isAdmin ? (
          <ConfirmDangerButton
            variant="outline"
            size="sm"
            className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10"
            title={`Ngắt kết nối ${meta.label}?`}
            description="OAuth token sẽ bị xóa — cần kết nối lại để sync."
            confirmLabel="Ngắt kết nối"
            pendingLabel="Đang ngắt…"
            onConfirm={onDisconnect}
          >
            <Unplug className="w-4 h-4 mr-2" />
            Ngắt kết nối
          </ConfirmDangerButton>
        ) : null}

        <Collapsible open={diagOpen} onOpenChange={setDiagOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground hover:text-white">
              <FlaskConical className="w-3.5 h-3.5 mr-2" />
              Chẩn đoán connector
              <ChevronDown
                className={`w-3.5 h-3.5 ml-auto transition-transform ${diagOpen ? 'rotate-180' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-border justify-start"
              disabled={testing}
              onClick={onTest}
            >
              {testing
                ? 'Đang gọi…'
                : kind === 'salesforce'
                  ? 'Test API limits'
                  : 'Test portals'}
            </Button>
            {kind === 'zoho_projects' && onTestProjects ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full border-border justify-start"
                disabled={testing}
                onClick={onTestProjects}
              >
                Test projects
              </Button>
            ) : null}
            {kind === 'zoho_projects' && onTestTasks ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full border-border justify-start"
                disabled={testing}
                onClick={onTestTasks}
              >
                Test tasks
              </Button>
            ) : null}
            {isAdmin && onSyncSnapshot ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full border-border justify-start"
                disabled={syncing}
                onClick={onSyncSnapshot}
              >
                <Database className="w-3.5 h-3.5 mr-2" />
                {syncing ? 'Đang sync…' : 'Sync snapshot riêng'}
              </Button>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Card>
  );
}

type PromptProps = {
  kind: ProviderKind;
  isAdmin: boolean;
  onConnect: () => void;
};

export function IntegrationConnectPrompt({ kind, isAdmin, onConnect }: PromptProps) {
  const meta = META[kind];
  return (
    <Card className="p-5 bg-card/40 border-dashed border-2 border-border h-full flex flex-col justify-center">
      <div className="text-center sm:text-left">
        <h2 className="font-semibold text-white">{meta.short}</h2>
        <p className="text-sm text-muted-foreground mt-1">Chưa kết nối OAuth</p>
        {isAdmin ? (
          <Button className="mt-4 bg-primary hover:bg-primary/90 w-full sm:w-auto" onClick={onConnect}>
            <Plug className="w-4 h-4 mr-2" />
            Kết nối {meta.label}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground mt-4">Chỉ admin cấu hình connector.</p>
        )}
      </div>
    </Card>
  );
}

export { META as INTEGRATION_PROVIDER_META };
