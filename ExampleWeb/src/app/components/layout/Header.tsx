import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

const SESSION_KEY = 'gw_session';
const USER_KEY = 'gw_user';

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase().slice(0, 2);
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

export function Header() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
      setUser(sessionStorage.getItem(USER_KEY));
    } else {
      setUser(null);
    }
  }, [loc.pathname]);

  const hostLine = useMemo(() => {
    if (!user) return '';
    return typeof window !== 'undefined' ? window.location.host : '';
  }, [user, loc.pathname]);

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(USER_KEY);
    setUser(null);
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
              <p className="text-xs font-bold text-white">{user}</p>
              {hostLine ? (
                <p className="text-[10px] text-muted-foreground">{hostLine}</p>
              ) : null}
            </div>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-amber-400 flex items-center justify-center text-white font-bold text-xs">
              {initials(user)}
            </div>
            <button
              type="button"
              onClick={logout}
              className="text-xs text-muted-foreground hover:text-primary transition"
            >
              Thoát
            </button>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Chưa đăng nhập</span>
            <Link to="/login" className="text-xs font-medium text-primary hover:underline">
              Đăng nhập
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
