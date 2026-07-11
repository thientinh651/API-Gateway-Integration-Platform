import { Link } from 'react-router';
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, XCircle } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import type { PipelineStep, PipelineStepStatus } from '../../../lib/integrationPipeline';

function statusMeta(status: PipelineStepStatus) {
  switch (status) {
    case 'ok':
      return {
        icon: CheckCircle2,
        badge: 'OK',
        className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
        iconClass: 'text-emerald-400',
      };
    case 'skipped':
      return {
        icon: AlertTriangle,
        badge: 'SKIPPED',
        className: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
        iconClass: 'text-amber-400',
      };
    case 'failed':
      return {
        icon: XCircle,
        badge: 'FAILED',
        className: 'bg-red-500/15 text-red-300 border-red-500/35',
        iconClass: 'text-red-400',
      };
    default:
      return {
        icon: Circle,
        badge: '—',
        className: 'bg-slate-500/15 text-slate-400 border-slate-500/35',
        iconClass: 'text-slate-500',
      };
  }
}

type Props = {
  steps: PipelineStep[];
  onScrollLogs?: () => void;
};

export function IntegrationPipelinePanel({ steps, onScrollLogs }: Props) {
  return (
    <Card className="p-5 sm:p-6 bg-card/80 border-primary/20 border scroll-mt-24" id="section-pipeline">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Pipeline đồng bộ</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Snapshot SF → Lọc Closed Won → Push Zoho → Sync Log (qua gateway loopback)
          </p>
        </div>
        {onScrollLogs ? (
          <button
            type="button"
            className="text-xs text-primary hover:underline shrink-0 text-left"
            onClick={onScrollLogs}
          >
            Xem chi tiết Sync Log ↓
          </button>
        ) : null}
      </div>

      <div className="flex flex-col lg:flex-row lg:items-stretch gap-3">
        {steps.map((step, i) => {
          const meta = statusMeta(step.status);
          const Icon = meta.icon;
          return (
            <div key={step.key} className="flex flex-col lg:flex-row lg:items-center gap-3 flex-1 min-w-0">
              <div className="flex-1 rounded-xl border border-border bg-slate-900/40 p-4 min-w-0">
                <div className="flex items-start gap-3">
                  <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${meta.iconClass}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-white">{step.label}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${meta.className}`}>
                        {meta.badge}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{step.summary}</p>
                  </div>
                </div>
              </div>
              {i < steps.length - 1 ? (
                <ArrowRight
                  className="w-5 h-5 text-muted-foreground shrink-0 hidden lg:block"
                  aria-hidden
                />
              ) : null}
              {i < steps.length - 1 ? (
                <div className="flex justify-center lg:hidden" aria-hidden>
                  <ArrowRight className="w-4 h-4 text-muted-foreground rotate-90" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
