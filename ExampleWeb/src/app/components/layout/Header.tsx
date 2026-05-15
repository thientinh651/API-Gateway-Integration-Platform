import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
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
    <header className="h-16 border-b border-border flex items-center justify-between px-8 sticky top-0 bg-background/80 backdrop-blur-md z-10">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Dashboard Quản trị
      </h2>
      <div className="flex items-center space-x-4">
        {user ? (
          <>
            <div className="text-right mr-2">
              <p className="text-xs font-bold text-white">{user.username}</p>
              {hostLine ? (
                <p className="text-[10px] text-muted-foreground">{hostLine}</p>
              ) : null}
            </div>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-amber-400 flex items-center justify-center text-white font-bold text-xs">
              {initials(user.username)}
            </div>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-primary transition"
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
