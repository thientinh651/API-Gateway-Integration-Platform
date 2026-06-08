import { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card } from '../ui/card';
import { cn } from '../ui/utils';

type Props = {
  to: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
};

/** Card có hover — bọc Link để bấm điều hướng. */
export function NavCard({ to, children, className, ariaLabel }: Props) {
  return (
    <Link
      to={to}
      aria-label={ariaLabel}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card
        className={cn(
          'cursor-pointer hover:border-primary/35 transition-colors',
          className
        )}
      >
        {children}
      </Card>
    </Link>
  );
}
