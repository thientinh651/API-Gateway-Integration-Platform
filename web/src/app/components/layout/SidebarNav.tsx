import { Link, useLocation } from 'react-router';
import { Layers } from 'lucide-react';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { canAccessNavPath } from '../../../lib/rbac';
import { NAV_ITEMS } from './navConfig';

type Props = {
  onNavigate?: () => void;
  className?: string;
};

export function SidebarNav({ onNavigate, className = '' }: Props) {
  const location = useLocation();
  const { user, loading } = useAdminAuth();
  const visibleItems = loading
    ? NAV_ITEMS.filter((item) => item.path === '/' || item.path === '/api-docs')
    : NAV_ITEMS.filter((item) => canAccessNavPath(item.path, user));

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="p-4 sm:p-6">
        <a
          href="https://thientinh.io.vn"
          rel="noopener noreferrer"
          onClick={onNavigate}
          className="flex items-center space-x-3 rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 transition-opacity"
        >
          <div className="bg-primary p-2 rounded-lg shadow-lg shadow-primary/20 shrink-0">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold text-white tracking-tight italic">
            AVASO <span className="text-primary">GW</span>
          </span>
        </a>
      </div>

      <nav className="flex-grow px-3 sm:px-4 space-y-1 overflow-y-auto overscroll-contain">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={`flex items-center space-x-2 p-2 min-h-[44px] rounded-xl transition touch-manipulation border-l-2 ${
                isActive
                  ? 'text-primary bg-primary/10 border-primary shadow-[inset_0_0_20px_rgba(249,115,22,0.08)] font-medium'
                  : 'text-muted-foreground border-transparent hover:bg-primary/10 hover:text-primary hover:border-primary/30 active:bg-primary/15'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="font-medium text-sm leading-snug">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 sm:p-6 border-t border-border shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center space-x-3 text-xs text-muted-foreground">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />
          <span
            className="truncate font-mono-tech text-[11px]"
            title={typeof window !== 'undefined' ? window.location.host : ''}
          >
            {typeof window !== 'undefined' ? window.location.host : 'gateway'}
          </span>
        </div>
      </div>
    </div>
  );
}
