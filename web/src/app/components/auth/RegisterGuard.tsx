import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useGatewayFeatures } from '../../../contexts/GatewayFeaturesContext';
import { TechPanel } from '../tech/TechPanel';
import { Button } from '../ui/button';

export function RegisterGuard({ children }: { children: ReactNode }) {
  const { features, loading } = useGatewayFeatures();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && features && !features.features.register_viewer) {
      navigate('/login', { replace: true, state: { registrationDisabled: true } });
    }
  }, [features, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!features?.features.register_viewer) {
    return <Navigate to="/login" replace state={{ registrationDisabled: true }} />;
  }

  return <>{children}</>;
}

export function RegistrationDisabledNotice() {
  return (
    <TechPanel className="w-full max-w-md p-6 text-center">
      <h2 className="text-lg font-bold text-white mb-2">Đăng ký đang tắt</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Đăng ký công khai đang tắt. Liên hệ quản trị viên để được cấp tài khoản.
      </p>
      <Button asChild className="bg-primary hover:bg-primary/90">
        <Link to="/login">Về đăng nhập</Link>
      </Button>
    </TechPanel>
  );
}
