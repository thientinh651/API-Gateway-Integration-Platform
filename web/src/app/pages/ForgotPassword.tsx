import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Layers } from 'lucide-react';
import { TechPanel } from '../components/tech/TechPanel';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  requestPasswordReset,
  resetPasswordWithToken,
  verifyResetOtp,
  type PasswordResetDelivery,
} from '../../lib/api';
import { ApiClientError } from '../../lib/apiClientError';
import { FieldError } from '../components/forms/FieldError';
import { setSavedUsername } from '../../lib/demoAuthStorage';

type Step = 'verify' | 'otp' | 'password';

export function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('verify');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [emailMasked, setEmailMasked] = useState('');
  const [delivery, setDelivery] = useState<PasswordResetDelivery | null>(null);
  const [resetToken, setResetToken] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const backToVerify = () => {
    setStep('verify');
    setOtp('');
    setResetToken('');
    setPassword('');
    setConfirm('');
    setFieldErrors({});
  };

  const onVerifyAccount = async (e: FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!username.trim()) errors.username = 'Nhập tên đăng nhập';
    if (!email.trim()) errors.email = 'Nhập email';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setBusy(true);
    setFieldErrors({});
    try {
      const res = await requestPasswordReset({
        username: username.trim(),
        email: email.trim(),
      });
      setUsername(res.username ?? username.trim());
      setEmailMasked(res.email_masked ?? '');
      setDelivery(res.delivery ?? null);
      setStep('otp');
      toast.success(res.message, { duration: 12000 });
      if (res.delivery === 'dev_log') {
        toast.info('Chưa có mail — OTP nằm log server: journalctl -u avaso-gateway -f', {
          duration: 15000,
        });
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) {
        setFieldErrors(err.fields);
      }
      toast.error(err instanceof ApiClientError ? err.message : 'Xác minh tài khoản thất bại');
    } finally {
      setBusy(false);
    }
  };

  const onVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    if (otp.trim().length !== 6) {
      setFieldErrors({ otp: 'OTP gồm 6 chữ số' });
      return;
    }
    setBusy(true);
    setFieldErrors({});
    try {
      const res = await verifyResetOtp({ username, otp: otp.trim() });
      setResetToken(res.reset_token);
      setStep('password');
      toast.success('OTP đúng — nhập mật khẩu mới.');
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) {
        setFieldErrors(err.fields);
      }
      toast.error(err instanceof ApiClientError ? err.message : 'OTP không hợp lệ');
    } finally {
      setBusy(false);
    }
  };

  const onSetPassword = async (e: FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (password.length < 6) errors.password = 'Mật khẩu tối thiểu 6 ký tự';
    if (password !== confirm) errors.confirm_password = 'Mật khẩu xác nhận không khớp';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setBusy(true);
    setFieldErrors({});
    try {
      await resetPasswordWithToken({ reset_token: resetToken, password });
      const recovered = username.trim();
      setSavedUsername(recovered);
      toast.success('Đã đặt lại mật khẩu.');
      navigate('/login', { state: { username: recovered } });
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) {
        setFieldErrors(err.fields);
      }
      toast.error(err instanceof ApiClientError ? err.message : 'Đặt lại mật khẩu thất bại');
    } finally {
      setBusy(false);
    }
  };

  const stepTitle =
    step === 'verify'
      ? 'Quên mật khẩu'
      : step === 'otp'
        ? 'Nhập mã OTP'
        : 'Mật khẩu mới';

  const stepHint =
    step === 'verify'
      ? 'Nhập tên đăng nhập và email đã đăng ký. Hệ thống chỉ gửi OTP khi hai thông tin khớp.'
      : step === 'otp'
        ? delivery === 'dev_log'
          ? 'Server chưa gửi email thật — xem OTP trong journalctl gateway.'
          : emailMasked
            ? `Mã 6 số đã gửi tới ${emailMasked} (hiệu lực 10 phút).`
            : 'Mã 6 số gửi qua email (hiệu lực 10 phút).'
        : 'OTP đã xác minh — đặt mật khẩu mới.';

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 tech-grid-bg opacity-50" aria-hidden />
      <a
        href="https://thientinh.io.vn"
        rel="noopener noreferrer"
        className="relative z-[1] mb-8 flex items-center gap-3"
      >
        <div className="bg-primary p-2 rounded-lg">
          <Layers className="w-6 h-6 text-white" />
        </div>
        <span className="text-xl font-bold text-white italic">
          AVASO <span className="text-primary">GW</span>
        </span>
      </a>

      <TechPanel className="relative z-[1] w-full max-w-md p-6 sm:p-8">
        <div className="flex gap-2 mb-4 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className={step === 'verify' ? 'text-primary font-bold' : ''}>1. Tài khoản</span>
          <span>→</span>
          <span className={step === 'otp' ? 'text-primary font-bold' : ''}>2. OTP</span>
          <span>→</span>
          <span className={step === 'password' ? 'text-primary font-bold' : ''}>3. Mật khẩu</span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-1">{stepTitle}</h1>
        <p className="text-xs text-muted-foreground mb-6">{stepHint}</p>

        {step === 'verify' && (
          <form onSubmit={(ev) => void onVerifyAccount(ev)} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="fp-username">Tên đăng nhập</Label>
              <Input
                id="fp-username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setFieldErrors((p) => {
                    const n = { ...p };
                    delete n.username;
                    return n;
                  });
                }}
                placeholder="admin"
                autoComplete="username"
                className="bg-input border-border"
                aria-invalid={Boolean(fieldErrors.username)}
              />
              <FieldError message={fieldErrors.username} />
            </div>
            <div>
              <Label htmlFor="fp-email">Email</Label>
              <Input
                id="fp-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldErrors((p) => {
                    const n = { ...p };
                    delete n.email;
                    return n;
                  });
                }}
                placeholder="you@example.com"
                autoComplete="email"
                className="bg-input border-border"
                aria-invalid={Boolean(fieldErrors.email)}
              />
              <FieldError message={fieldErrors.email} />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Đang kiểm tra…' : 'Xác minh và gửi OTP'}
            </Button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={(ev) => void onVerifyOtp(ev)} className="space-y-4" noValidate>
            <div>
              <Label>Tên đăng nhập</Label>
              <p className="text-sm text-slate-300 font-mono py-2 px-3 rounded-md bg-slate-900/60 border border-border">
                {username}
              </p>
            </div>
            <div>
              <Label>Email</Label>
              <p className="text-sm text-slate-300 py-2 px-3 rounded-md bg-slate-900/60 border border-border">
                {emailMasked || email}
              </p>
            </div>
            <div>
              <Label htmlFor="fp-otp">Mã OTP</Label>
              <Input
                id="fp-otp"
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setFieldErrors((p) => {
                    const n = { ...p };
                    delete n.otp;
                    return n;
                  });
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="bg-input border-border font-mono tracking-widest text-center text-lg"
                aria-invalid={Boolean(fieldErrors.otp)}
              />
              <FieldError message={fieldErrors.otp} />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Đang kiểm tra…' : 'Xác nhận OTP'}
            </Button>
            <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={backToVerify}>
              Quay lại / gửi lại OTP
            </Button>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={(ev) => void onSetPassword(ev)} className="space-y-4" noValidate>
            <div>
              <Label>Tên đăng nhập</Label>
              <p className="text-sm text-slate-300 font-mono py-2 px-3 rounded-md bg-slate-900/60 border border-border">
                {username}
              </p>
            </div>
            <div>
              <Label htmlFor="fp-pass">Mật khẩu mới</Label>
              <Input
                id="fp-pass"
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
                className="bg-input border-border"
                aria-invalid={Boolean(fieldErrors.password)}
              />
              <FieldError message={fieldErrors.password} />
            </div>
            <div>
              <Label htmlFor="fp-confirm">Xác nhận mật khẩu</Label>
              <Input
                id="fp-confirm"
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
                className="bg-input border-border"
                aria-invalid={Boolean(fieldErrors.confirm_password)}
              />
              <FieldError message={fieldErrors.confirm_password} />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Đang lưu…' : 'Đặt lại mật khẩu'}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link
            to="/login"
            state={username.trim() ? { username: username.trim() } : undefined}
            className="text-primary hover:underline"
          >
            ← Đăng nhập
          </Link>
        </p>
      </TechPanel>
    </div>
  );
}
