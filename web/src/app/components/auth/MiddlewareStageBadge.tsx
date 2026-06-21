import { Badge } from '../ui/badge';
import {
  inferMiddlewareStage,
  MIDDLEWARE_STAGE_VI,
  type MiddlewareStage,
} from '../../../lib/middlewareLabels';
import { cn } from '../ui/utils';

const STAGE_TONE: Record<MiddlewareStage, string> = {
  authentication: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  authorization: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  rate_limit: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  routing: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
  upstream: 'bg-red-500/10 text-red-400 border-red-500/30',
  success: 'bg-primary/10 text-primary border-primary/30',
};

type Props = {
  status: number;
  reason?: string | null;
  outcome?: string | null;
  bodyJson?: unknown;
  className?: string;
};

export function MiddlewareStageBadge({ status, reason, outcome, bodyJson, className }: Props) {
  const stage = inferMiddlewareStage(status, reason, outcome, bodyJson);
  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] font-semibold border', STAGE_TONE[stage], className)}
    >
      {MIDDLEWARE_STAGE_VI[stage]}
    </Badge>
  );
}
