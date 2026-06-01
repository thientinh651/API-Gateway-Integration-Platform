import type { ReactNode } from 'react';
import { Badge } from '../ui/badge';
import { cn } from '../ui/utils';

type Props = {
  method: string;
  path: string;
  description: string;
  methodColorClass: string;
  children?: ReactNode;
};

export function ApiEndpointCard({ method, path, description, methodColorClass, children }: Props) {
  return (
    <div
      data-method={method}
      className="tech-endpoint-row p-4 rounded-lg bg-background/40 border border-border/60"
    >
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <Badge className={cn(methodColorClass, 'border font-mono-tech text-[11px]')}>{method}</Badge>
        <code className="text-sm text-slate-200 font-mono-tech break-all">{path}</code>
      </div>
      <p className="text-sm text-muted-foreground mb-2">{description}</p>
      {children}
    </div>
  );
}
