import { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card } from '../ui/card';
import { cn } from '../ui/utils';

interface StatsCardProps {
  icon: ReactNode;
  iconBg: string;
  title: string;
  value: string;
  hint?: string;
  badge?: {
    text: string;
    variant: 'success' | 'warning' | 'info' | 'danger';
  };
  valueTone?: 'default' | 'success' | 'danger' | 'warning';
  /** Bấm card → điều hướng trang liên quan. */
  to?: string;
}

export function StatsCard({
  icon,
  iconBg,
  title,
  value,
  hint,
  badge,
  valueTone = 'default',
  to,
}: StatsCardProps) {
  const badgeColors = {
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    info: 'text-slate-400',
    danger: 'text-red-400',
  };

  const valueColors = {
    default: 'text-white',
    success: 'text-emerald-400',
    danger: 'text-red-400',
    warning: 'text-amber-400',
  };

  const body = (
    <Card
      className={cn(
        'h-full min-h-[7rem] p-4 rounded-xl bg-card/70 border-border/80 transition-colors group',
        'flex flex-col justify-between gap-2.5',
        to && 'cursor-pointer hover:border-primary/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`p-2 ${iconBg} rounded-lg ring-1 ring-white/5 shrink-0`}>{icon}</div>
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-wide text-right leading-tight min-h-[1.25rem]',
            badge ? badgeColors[badge.variant] : 'invisible',
          )}
        >
          {badge?.text ?? '—'}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          {title}
        </p>
        <p
          className={cn(
            'text-xl sm:text-2xl font-bold font-mono-tech tracking-tight tabular-nums',
            valueColors[valueTone],
          )}
        >
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground mt-1 min-h-[1rem] truncate">
          {hint ?? '\u00a0'}
        </p>
      </div>
    </Card>
  );

  if (!to) return body;

  return (
    <Link
      to={to}
      aria-label={title}
      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  );
}
