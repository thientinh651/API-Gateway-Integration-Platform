import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Layers } from 'lucide-react';
import { MobileNav } from './MobileNav';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Button } from '../ui/button';
import { adminLogout } from '../../../lib/api';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase().slice(0, 2);
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

export function Header() {
  const loc = useLocation();
  const navigate = useNavigate();
  const { user, clearUser } = useAdminAuth();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const hostLine = useMemo(() => {
    if (!user) return '';
    return typeof window !== 'undefined' ? window.location.host : '';
  }, [user, loc.pathname]);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await adminLogout();
    } catch {
      /* vẫn thoát UI */
    }
    setLoggingOut(false);
    setLogoutOpen(false);
    clearUser();
    navigate('/login');
  };

  return (
    <header className="min-h-14 border-b border-border/80 flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-2 sticky top-0 bg-background/85 backdrop-blur-xl z-20 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-[0_1px_0_rgba(249,115,22,0.08)]">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <MobileNav />
        {user ? (
          <h2 className="text-xs sm:text-sm font-semibold uppercase tracking-widest text-muted-foreground truncate">
            <span className="sm:hidden">Dashboard</span>
            <span className="hidden sm:inline">Dashboard Quản trị</span>
          </h2>
        ) : (
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="p-1.5 rounded-lg bg-primary/15 ring-1 ring-primary/30 shrink-0">
              <Layers className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white tracking-tight leading-none truncate">
                AVASO Gateway
              </p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5 hidden sm:block truncate">
                Integration Middleware
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {user ? (
          <>
            <div className="text-right mr-0 sm:mr-2 hidden min-[400px]:block min-w-0">
              <p className="text-xs font-bold text-white truncate max-w-[120px] sm:max-w-none">
                {user.username}
              </p>
              {hostLine ? (
                <p className="text-[10px] text-muted-foreground truncate max-w-[120px] sm:max-w-none hidden sm:block">
                  {hostLine}
                </p>
              ) : null}
            </div>
            <div
              className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-amber-400 flex items-center justify-center text-white font-bold text-xs shrink-0"
              title={user.username}
            >
              {initials(user.username)}
            </div>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-primary transition px-2 py-2 min-h-[44px] touch-manipulation"
              onClick={() => setLogoutOpen(true)}
            >
              Thoát
            </button>
            <AlertDialog open={logoutOpen} onOpenChange={(open) => !loggingOut && setLogoutOpen(open)}>
              <AlertDialogContent className="z-[100]">
                <AlertDialogHeader>
                  <AlertDialogTitle>Đăng xuất?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Bạn có chắc muốn thoát khỏi phiên quản trị?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loggingOut}
                    onClick={() => setLogoutOpen(false)}
                  >
                    Hủy
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={loggingOut}
                    onClick={() => void logout()}
                  >
                    {loggingOut ? 'Đang thoát…' : 'Đăng xuất'}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <Button asChild size="sm" variant="outline" className="border-border text-xs h-8">
            <Link to="/login">Đăng nhập</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
