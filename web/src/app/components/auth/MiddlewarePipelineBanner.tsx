import {
  ArrowRight,
  FileText,
  GitMerge,
  Gauge,
  ListOrdered,
  Plug,
  Route,
  ShieldCheck,
} from 'lucide-react';
import { Card } from '../ui/card';
import { cn } from '../ui/utils';

const STAGES = [
  {
    id: 'auth',
    icon: ShieldCheck,
    title: 'Auth',
    detail: 'Client Registry + HMAC',
    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  },
  {
    id: 'route',
    icon: Route,
    title: 'Routing',
    detail: 'Route / connector SF·Zoho',
    color: 'text-primary bg-primary/10 border-primary/25',
  },
  {
    id: 'transform',
    icon: GitMerge,
    title: 'Transform',
    detail: 'Canonical schema map',
    color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/25',
  },
  {
    id: 'upstream',
    icon: Plug,
    title: 'Connector',
    detail: 'OAuth + upstream API',
    color: 'text-violet-400 bg-violet-500/10 border-violet-500/25',
  },
  {
    id: 'rl',
    icon: Gauge,
    title: 'Rate limit',
    detail: 'Client → route → global',
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  },
  {
    id: 'log',
    icon: FileText,
    title: 'Logging',
    detail: 'Transaction log',
    color: 'text-sky-400 bg-sky-500/10 border-sky-500/25',
  },
  {
    id: 'queue',
    icon: ListOrdered,
    title: 'Queue',
    detail: 'Retry + DLQ worker',
    color: 'text-orange-400 bg-orange-500/10 border-orange-500/25',
  },
] as const;

export function MiddlewarePipelineBanner({ compact = false }: { compact?: boolean }) {
  return (
    <Card className={cn('bg-card/80 border-border', compact ? 'p-4' : 'p-5 sm:p-6')}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-4">
        Integration Platform pipeline
      </p>
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-2 overflow-x-auto pb-1">
        {STAGES.map((stage, idx) => {
          const Icon = stage.icon;
          return (
            <div key={stage.id} className="flex items-center gap-2 lg:flex-1 min-w-[120px]">
              <div className={cn('flex-1 rounded-xl border p-3 min-w-0', stage.color)}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-bold text-white truncate">{stage.title}</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">{stage.detail}</p>
              </div>
              {idx < STAGES.length - 1 ? (
                <ArrowRight className="hidden lg:block w-4 h-4 text-muted-foreground/40 shrink-0" />
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
