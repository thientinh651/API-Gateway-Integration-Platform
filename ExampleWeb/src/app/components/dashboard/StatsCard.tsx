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
    <Card className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border-border">
      <div className="flex justify-between items-start mb-4">
        <div className={`p-2 ${iconBg} rounded-lg`}>{icon}</div>
        {badge && (
          <span className={`text-[10px] font-bold ${badgeColors[badge.variant]}`}>
            {badge.text}
          </span>
        )}
      </div>
      <p className="text-muted-foreground text-xs mb-1">{title}</p>
      <h3 className="text-2xl font-bold text-white">{value}</h3>
    </Card>
  );
}
