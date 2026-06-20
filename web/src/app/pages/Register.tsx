import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Layers } from 'lucide-react';
import { toast } from 'sonner';
import { TechPanel } from '../components/tech/TechPanel';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { registerViewer } from '../../lib/api';
import { ApiClientError } from '../../lib/apiClientError';
import { FieldError } from '../components/forms/FieldError';
import { isValidEmail } from '../../lib/formValidation';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { roleDescription, roleLabel } from '../../lib/rbac';

export function Register() {
  const navigate = useNavigate();
  const { refresh } = useAdminAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!username.trim()) errors.username = 'Nhập tên đăng nhập';
    if (!email.trim()) errors.email = 'Nhập email';
    else if (!isValidEmail(email.trim())) errors.email = 'Email không hợp lệ';
    if (password.length < 6) errors.password = 'Mật khẩu tối thiểu 6 ký tự';
    if (password !== confirm) errors.confirm_password = 'Mật khẩu xác nhận không khớp';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setBusy(true);
    setFieldErrors({});
    try {
      await registerViewer({
        username: username.trim(),
        email: email.trim(),
        password,
      });
      await refresh();
      toast.success('Đăng ký thành công — vai trò Viewer.');
      navigate('/');
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) {
        setFieldErrors(err.fields);
      }
      toast.error(err instanceof ApiClientError ? err.message : 'Đăng ký thất bại');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 tech-grid-bg opacity-50" aria-hidden />
      <div className="pointer-events-none absolute top-1/4 -right-32 w-96 h-96 rounded-full bg-primary/15 blur-[120px]" aria-hidden />
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
        <h1 className="text-2xl font-bold text-white mb-1">Đăng ký</h1>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
          Triển khai on-prem: đăng ký công khai thường <strong className="text-slate-300">tắt</strong> — nhờ
          Admin cấp tài khoản. Trang này chỉ dùng khi server bật{' '}
          <code className="text-[10px]">ALLOW_VIEWER_REGISTRATION=1</code>.
        </p>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="reg-user" className="text-foreground">
              Tên đăng nhập
            </Label>
            <Input
              id="reg-user"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setFieldErrors((p) => {
                  const n = { ...p };
                  delete n.username;
                  return n;
                });
              }}
              aria-invalid={Boolean(fieldErrors.username)}
              className={`bg-input border-border text-foreground ${fieldErrors.username ? 'border-destructive' : ''}`}
            />
            <FieldError message={fieldErrors.username} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reg-email" className="text-foreground">
              Email
            </Label>
            <Input
              id="reg-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldErrors((p) => {
                  const n = { ...p };
                  delete n.email;
                  return n;
                });
              }}
              aria-invalid={Boolean(fieldErrors.email)}
              className={`bg-input border-border text-foreground ${fieldErrors.email ? 'border-destructive' : ''}`}
            />
            <FieldError message={fieldErrors.email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reg-pass" className="text-foreground">
              Mật khẩu
            </Label>
            <Input
              id="reg-pass"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldErrors((p) => {
                  const n = { ...p };
                  delete n.password;
                  return n;
                });
              }}
              aria-invalid={Boolean(fieldErrors.password)}
              className={`bg-input border-border text-foreground ${fieldErrors.password ? 'border-destructive' : ''}`}
            />
            <FieldError message={fieldErrors.password} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reg-confirm" className="text-foreground">
              Xác nhận mật khẩu
            </Label>
            <Input
              id="reg-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setFieldErrors((p) => {
                  const n = { ...p };
                  delete n.confirm_password;
                  return n;
                });
              }}
              aria-invalid={Boolean(fieldErrors.confirm_password)}
              className={`bg-input border-border text-foreground ${fieldErrors.confirm_password ? 'border-destructive' : ''}`}
            />
            <FieldError message={fieldErrors.confirm_password} />
          </div>
          <Button type="submit" disabled={busy} className="w-full bg-primary hover:bg-primary/90">
            {busy ? 'Đang đăng ký…' : 'Đăng ký Viewer'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Đã có tài khoản?{' '}
          <Link to="/login" className="text-primary hover:underline">
            Đăng nhập
          </Link>
        </p>
      </TechPanel>
    </div>
  );
}
