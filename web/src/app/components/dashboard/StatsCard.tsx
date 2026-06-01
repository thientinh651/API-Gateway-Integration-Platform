import { ReactNode } from 'react';
import { Card } from '../ui/card';

interface StatsCardProps {
  icon: ReactNode;
  iconBg: string;
  title: string;
  value: string;
  badge?: {
    text: string;
    variant: 'success' | 'warning' | 'info';
  };
}

export function StatsCard({ icon, iconBg, title, value, badge }: StatsCardProps) {
  const badgeColors = {
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    info: 'text-slate-400',
  };

  return (
    <Card className="p-6 rounded-2xl bg-card/60 backdrop-blur-sm border-border/80 hover:border-primary/25 transition-colors group overflow-hidden relative">
      <div className="pointer-events-none absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex justify-between items-start mb-4 relative">
        <div className={`p-2 ${iconBg} rounded-lg ring-1 ring-white/5`}>{icon}</div>
        {badge && (
          <span className={`text-[10px] font-bold font-mono-tech uppercase tracking-wider ${badgeColors[badge.variant]}`}>
            {badge.text}
          </span>
        )}
      </div>
      <p className="tech-label mb-1">{title}</p>
      <h3 className="text-2xl font-bold text-white font-mono-tech tracking-tight">{value}</h3>
    </Card>
  );
}
