import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '../ui/utils';

type Step = { id: string; label: string; detail: string };

const STEPS: Step[] = [
  { id: 'create', label: 'Tạo key', detail: 'Nhận API Key + Secret một lần' },
  { id: 'copy', label: 'Lưu Secret', detail: 'Secret không xem lại trên dashboard' },
  { id: 'call', label: 'Gọi proxy', detail: 'Thử path /v1/api/... qua gateway' },
];

type Props = {
  activeStep?: 'create' | 'copy' | 'call';
  compact?: boolean;
};

export function ClientKeyFlowSteps({ activeStep = 'create', compact }: Props) {
  const activeIdx = STEPS.findIndex((s) => s.id === activeStep);

  return (
    <div
      className={cn(
        'rounded-xl border border-border/80 bg-slate-950/40',
        compact ? 'p-3' : 'p-4 sm:p-5',
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-2">
        {STEPS.map((step, idx) => {
          const done = idx < activeIdx;
          const active = idx === activeIdx;
          return (
            <div key={step.id} className="flex items-center gap-2 sm:flex-1 min-w-0">
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                  done
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                    : active
                      ? 'border-primary/50 bg-primary/15 text-primary'
                      : 'border-border bg-slate-900 text-muted-foreground',
                )}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
              </div>
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-sm font-semibold truncate',
                    active ? 'text-white' : done ? 'text-emerald-400/90' : 'text-slate-400',
                  )}
                >
                  {step.label}
                </p>
                {!compact ? (
                  <p className="text-[11px] text-muted-foreground truncate">{step.detail}</p>
                ) : null}
              </div>
              {idx < STEPS.length - 1 ? (
                <ArrowRight className="hidden sm:block h-4 w-4 text-muted-foreground/50 shrink-0 mx-1" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
