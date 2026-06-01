import type { ReactNode } from 'react';
import { cn } from '../ui/utils';

type Props = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  codeLine?: string;
};

export function TechPageHeader({ title, description, actions, codeLine }: Props) {
  return (
    <div className={cn('mb-6 sm:mb-8', actions && 'flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4')}>
      <div className="min-w-0">
        {codeLine ? (
          <p className="tech-label font-mono-tech text-primary/80 mb-2 flex items-center gap-2">
            <span className="tech-status-dot" aria-hidden />
            {codeLine}
          </p>
        ) : null}
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2 tracking-tight">{title}</h1>
        {description ? (
          <div className="text-muted-foreground text-sm sm:text-base max-w-2xl leading-relaxed">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
