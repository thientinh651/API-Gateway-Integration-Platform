import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import { toast } from 'sonner';
import { adminLogin, ApiClientError } from '../../../lib/api';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { getSavedUsername, setSavedUsername, SAVED_USERNAME_KEY } from '../../../lib/demoAuthStorage';

type FieldErrors = {
  username?: string;
  password?: string;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive mt-1">{message}</p>;
}

function applyApiFieldErrors(fields?: Record<string, string>): FieldErrors {
  const next: FieldErrors = {};
  if (fields?.username) next.username = fields.username;
  if (fields?.password) next.password = fields.password;
  return next;
}

export function LoginForm() {
  const navigate = useNavigate();
  const { refresh } = useAdminAuth();
  const [username, setUsername] = useState(() =>
    typeof window !== 'undefined' ? getSavedUsername() ?? '' : ''
  );
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(SAVED_USERNAME_KEY) != null : false
  );
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const failWithFields = (fields: FieldErrors, toastMessage: string) => {
    setFieldErrors(fields);
    toast.error(toastMessage);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!username.trim()) {
      next.username = 'Nhập tên đăng nhập';
    }
    if (!password) {
      next.password = 'Nhập mật khẩu';
    }
    if (Object.keys(next).length > 0) {
      failWithFields(next, 'Vui lòng kiểm tra các ô được đánh dấu.');
      return;
    }

    setFieldErrors({});
    setBusy(true);
    try {
      await adminLogin({ username: username.trim(), password });
      if (remember) setSavedUsername(username.trim());
      else setSavedUsername(null);
      await refresh();
      toast.success('Đăng nhập thành công.');
      navigate('/');
    } catch (err) {
      if (import.meta.env.DEV) console.debug('login failed', err);

      if (err instanceof ApiClientError) {
        const mapped = applyApiFieldErrors(err.fields);
        if (Object.keys(mapped).length > 0) {
          failWithFields(mapped, err.message || 'Đăng nhập thất bại.');
          return;
        }
        if (err.status === 401) {
          failWithFields({ password: 'Sai mật khẩu' }, 'Đăng nhập thất bại.');
          return;
        }
        if (err.status === 404) {
          toast.error('Không kết nối được máy chủ. Thử lại sau.');
          return;
        }
        toast.error(err.message || 'Đăng nhập thất bại.');
        return;
      }

      toast.error('Đăng nhập thất bại. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="login-user" className="text-foreground">
          Tên đăng nhập
        </Label>
        <Input
          id="login-user"
          autoComplete="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            clearFieldError('username');
          }}
          placeholder="admin"
          aria-invalid={Boolean(fieldErrors.username)}
          className={`bg-input border-border text-foreground ${fieldErrors.username ? 'border-destructive' : ''}`}
        />
        <FieldError message={fieldErrors.username} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-pass" className="text-foreground">
          Mật khẩu
        </Label>
        <Input
          id="login-pass"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearFieldError('password');
          }}
          placeholder="••••••••"
          aria-invalid={Boolean(fieldErrors.password)}
          className={`bg-input border-border text-foreground ${fieldErrors.password ? 'border-destructive' : ''}`}
        />
        <FieldError message={fieldErrors.password} />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="remember"
          checked={remember}
          onCheckedChange={(v) => setRemember(v === true)}
        />
        <Label htmlFor="remember" className="text-sm text-foreground cursor-pointer font-normal">
          Ghi nhớ tên đăng nhập
        </Label>
      </div>
      <div className="text-right">
        <Link to="/forgot-password" className="text-xs text-primary hover:underline">
          Quên mật khẩu?
        </Link>
      </div>
      <Button type="submit" disabled={busy} className="w-full bg-primary hover:bg-primary/90">
        {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </Button>
      <p className="text-center text-xs text-muted-foreground pt-1">
        Chưa có tài khoản Viewer?{' '}
        <Link to="/register" className="text-primary hover:underline">
          Đăng ký
        </Link>
      </p>
    </form>
  );
}
