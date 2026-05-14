import { Link } from 'react-router';
import { Layers } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { LoginForm } from './LoginForm';

export function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="mb-8 flex items-center gap-3">
        <div className="bg-primary p-2 rounded-lg shadow-lg shadow-primary/20">
          <Layers className="w-6 h-6 text-white" />
        </div>
        <span className="text-xl font-bold text-white tracking-tight italic">
          AVASO <span className="text-primary">GW</span>
        </span>
      </div>

      <Card className="w-full max-w-md rounded-2xl border-border bg-card/90 backdrop-blur-sm p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-white mb-1">Đăng nhập quản trị</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Phiên bản UI — session thật nối sau (SRS Admin plane).
        </p>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="text-primary hover:underline">
            ← Về dashboard
          </Link>
          {' · '}
          <a href="/login.html" className="text-muted-foreground hover:text-primary">
            login.html
          </a>
        </p>
      </Card>
    </div>
  );
}
