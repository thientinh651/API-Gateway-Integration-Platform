import { ArrowDown, ArrowRight } from 'lucide-react';
import { cn } from '../../components/ui/utils';

type Node = {
  label: string;
  detail?: string;
  tone?: string;
};

type Props = {
  nodes: Node[];
  className?: string;
  /** horizontal on md+, vertical on mobile */
  direction?: 'auto' | 'vertical';
};

const DEFAULT_TONE = 'border-border/80 bg-background/50 text-slate-200';

export function FlowDiagram({ nodes, className, direction = 'auto' }: Props) {
  const vertical = direction === 'vertical';
  return (
    <div
      className={cn(
        'flex gap-2 overflow-x-auto pb-1',
        vertical ? 'flex-col items-stretch' : 'flex-col md:flex-row md:items-stretch',
        className
      )}
    >
      {nodes.map((node, idx) => (
        <div
          key={`${node.label}-${idx}`}
          className={cn(
            'flex gap-2 min-w-0',
            vertical ? 'flex-col items-stretch' : 'flex-col md:flex-row md:items-center md:flex-1'
          )}
        >
          <div
            className={cn(
              'rounded-xl border px-3 py-2.5 min-w-0',
              vertical ? 'w-full' : 'flex-1',
              node.tone ?? DEFAULT_TONE
            )}
          >
            <p className="text-xs font-bold text-white leading-snug">{node.label}</p>
            {node.detail ? (
              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{node.detail}</p>
            ) : null}
          </div>
          {idx < nodes.length - 1 ? (
            <>
              <ArrowDown
                className={cn(
                  'w-4 h-4 text-muted-foreground/50 shrink-0 self-center',
                  !vertical && 'md:hidden'
                )}
                aria-hidden
              />
              {!vertical ? (
                <ArrowRight
                  className="hidden md:block w-4 h-4 text-muted-foreground/50 shrink-0"
                  aria-hidden
                />
              ) : null}
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
