import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { FileCode, Layers, LayoutDashboard } from 'lucide-react';
import { MobileNav } from './MobileNav';
import { WorkspaceSwitcher } from '../workspace/WorkspaceSwitcher';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { adminLogout } from '../../../lib/api';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { roleBadgeClass, roleLabel } from '../../../lib/rbac';

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase().slice(0, 2);
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

const GUEST_LINKS = [
  { to: '/', label: 'Tổng quan', icon: LayoutDashboard },
  { to: '/api-docs', label: 'Tài liệu API', icon: FileCode },
];

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clearUser } = useAdminAuth();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

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

  const role = roleLabel(user?.role);

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
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {user ? (
          <>
            <WorkspaceSwitcher />
            <div className="flex items-center gap-2 min-w-0 max-w-[min(100%,14rem)] sm:max-w-none">
              <Link
                to="/profile"
                className="text-xs font-bold text-white truncate leading-tight min-w-0 max-w-[5.5rem] sm:max-w-[10rem] hover:text-primary transition"
                title="Tài khoản của tôi"
              >
                {user.username}
              </Link>
              <Badge
                variant="outline"
                className={`shrink-0 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 border ${roleBadgeClass(user.role)}`}
                title={`Vai trò: ${role}`}
              >
                {role}
              </Badge>
            </div>
            <Link
              to="/profile"
              className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-amber-400 flex items-center justify-center text-white font-bold text-xs shrink-0 hover:ring-2 hover:ring-primary/50 transition"
              title={`${user.username} · ${role} — Tài khoản`}
            >
              {initials(user.username)}
            </Link>
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
          <>
            <nav className="hidden lg:flex items-center gap-1">
              {GUEST_LINKS.map(({ to, label, icon: Icon }) => {
                const isActive = location.pathname === to;
                return (
                  <Link
                    key={to}
                    to={to}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      isActive
                        ? 'text-primary bg-primary/10'
                        : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </nav>
            <Button asChild size="sm" className="h-8 bg-primary text-xs text-white hover:bg-primary/90">
              <Link to="/login">Đăng nhập</Link>
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
