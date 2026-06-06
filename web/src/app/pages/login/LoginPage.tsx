import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Layers } from 'lucide-react';
import { toast } from 'sonner';
import { TechPanel } from '../../components/tech/TechPanel';
import { LoginForm } from './LoginForm';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading } = useAdminAuth();

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (searchParams.get('expired') === '1') {
      toast.info('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }
  }, [searchParams]);

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 tech-grid-bg opacity-50" aria-hidden />
      <div className="pointer-events-none absolute top-1/4 -right-32 w-96 h-96 rounded-full bg-primary/15 blur-[120px]" aria-hidden />
      <div className="pointer-events-none absolute bottom-1/4 -left-32 w-80 h-80 rounded-full bg-blue-600/10 blur-[100px]" aria-hidden />
      <a
        href="https://thientinh.io.vn"
        rel="noopener noreferrer"
        className="relative z-[1] mb-8 flex items-center gap-3 rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 transition-opacity"
      >
        <div className="bg-primary p-2 rounded-lg shadow-lg shadow-primary/20">
          <Layers className="w-6 h-6 text-white" />
        </div>
        <span className="text-xl font-bold text-white tracking-tight italic">
          AVASO <span className="text-primary">GW</span>
        </span>
      </a>

      <TechPanel className="relative z-[1] w-full max-w-md p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-white mb-1">Đăng nhập</h1>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-muted-foreground font-mono-tech">
          <Link to="/" className="text-primary hover:underline">
            ← Trang chủ
          </Link>
        </p>
      </TechPanel>
    </div>
  );
}
