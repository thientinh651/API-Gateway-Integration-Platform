import type { ReactNode } from 'react';
import { cn } from '../ui/utils';

type Props = {
  children: ReactNode;
  className?: string;
  corners?: boolean;
};

/** Panel glass + viền gradient — phong cách console/devtool */
export function TechPanel({ children, className, corners = true }: Props) {
  return (
    <div className={cn('tech-panel relative overflow-hidden', className)}>
      {corners ? (
        <>
          <span className="tech-corner tech-corner-tl" aria-hidden />
          <span className="tech-corner tech-corner-br" aria-hidden />
        </>
      ) : null}
      {children}
    </div>
  );
}
