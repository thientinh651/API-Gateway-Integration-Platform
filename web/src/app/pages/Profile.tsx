import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  AlertTriangle,
  Building2,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { adminMe, updateAdminProfile } from '../../lib/api';
import { normalizeRole, roleBadgeClass, roleLabel } from '../../lib/rbac';
import { WorkspaceMembersPanel } from '../components/workspace/WorkspaceMembersPanel';
import {
  currentWorkspaceName,
  deploymentModeLabel,
  isSaasMode,
} from '../../lib/deployment';
import { FieldError } from '../components/forms/FieldError';
import {
  clearOneFieldError,
  failClientValidation,
  fieldInputErrorClass,
  handleFormApiError,
  isValidEmail,
} from '../../lib/formValidation';
import { cn } from '../components/ui/utils';

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase().slice(0, 2);
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

function roleBlurb(role?: string) {
  const r = normalizeRole(role);
  if (r === 'admin') return 'Toàn quyền quản trị workspace hiện tại.';
  if (r === 'operator') return 'Vận hành route và client OAuth — không đổi cài đặt hệ thống hay user.';
  return 'Chỉ xem dashboard, route và log — không sửa cấu hình.';
}

function PasswordInput({
  value,
  onChange,
  error,
  autoComplete,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  autoComplete: string;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={fieldInputErrorClass(Boolean(error), 'bg-input border-border pr-10')}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function CheckLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p className={cn('flex items-center gap-1.5 text-[11px]', ok ? 'text-emerald-400' : 'text-muted-foreground')}>
      <Check className="w-3 h-3" />
      {label}
    </p>
  );
}

export function Profile() {
  const navigate = useNavigate();
  const { user, refresh, clearUser } = useAdminAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [savedEmail, setSavedEmail] = useState('');
  const [infoPassword, setInfoPassword] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [infoBusy, setInfoBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [infoErrors, setInfoErrors] = useState<Record<string, string>>({});
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    setUsername(user.username);
    void adminMe()
      .then((me) => {
        const em = me.email ?? '';
        setEmail(em);
        setSavedEmail(em);
      })
      .catch(() => {});
  }, [user]);

  const usernameChanged = username.trim() !== (user?.username ?? '');
  const emailChanged = email.trim().toLowerCase() !== savedEmail.trim().toLowerCase();
  const profileDirty = usernameChanged || emailChanged;
  const longEnough = newPassword.length >= 6;
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const workspaceName = useMemo(() => currentWorkspaceName(user), [user]);

  if (!user) {
    return (
      <p className="text-sm text-muted-foreground">
        <button type="button" className="text-primary underline" onClick={() => navigate('/login')}>
          Đăng nhập
        </button>{' '}
        để xem hồ sơ.
      </p>
    );
  }

  const resetProfile = () => {
    setUsername(user.username);
    setEmail(savedEmail);
    setInfoPassword('');
    setInfoErrors({});
  };

  const closePasswordForm = () => {
    setChangingPassword(false);
    setLoginPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPwErrors({});
  };

  const onSaveInfo = async (e: FormEvent) => {
    e.preventDefault();
    if (!profileDirty) return;
    const errors: Record<string, string> = {};
    if (!username.trim()) errors.username = 'Nhập tên đăng nhập';
    const emailTrimmed = email.trim();
    if (emailTrimmed && !isValidEmail(emailTrimmed)) {
      errors.email = 'Email không hợp lệ';
    }
    if (!infoPassword) {
      errors.current_password = 'Nhập mật khẩu hiện tại để xác nhận';
    }
    if (Object.keys(errors).length > 0) {
      failClientValidation(setInfoErrors, errors);
      return;
    }
    setInfoBusy(true);
    setInfoErrors({});
    try {
      await updateAdminProfile({
        username: usernameChanged ? username.trim() : undefined,
        email: email.trim(),
        current_password: infoPassword,
      });
      await refresh();
      setSavedEmail(email.trim().toLowerCase());
      setInfoPassword('');
      toast.success('Đã lưu hồ sơ.');
    } catch (err) {
      handleFormApiError(err, setInfoErrors);
    } finally {
      setInfoBusy(false);
    }
  };

  const onChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!loginPassword) errors.current_password = 'Nhập mật khẩu hiện tại';
    if (!longEnough) errors.password = 'Mật khẩu mới tối thiểu 6 ký tự';
    if (!passwordsMatch) errors.confirm_password = 'Hai mật khẩu mới chưa khớp';
    if (Object.keys(errors).length > 0) {
      failClientValidation(setPwErrors, errors);
      return;
    }
    setPwBusy(true);
    setPwErrors({});
    try {
      const res = await updateAdminProfile({
        password: newPassword,
        current_password: loginPassword,
      });
      if (res.password_changed) {
        clearUser();
        toast.success('Đã đổi mật khẩu. Đăng nhập lại bằng mật khẩu mới.');
        navigate('/login');
        return;
      }
      closePasswordForm();
      toast.success('Đã đổi mật khẩu.');
    } catch (err) {
      handleFormApiError(err, setPwErrors);
    } finally {
      setPwBusy(false);
    }
  };

  const saas = isSaasMode(user.deployment_mode);
  const displayEmail = savedEmail.trim();

  return (
    <div>
      <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Tài khoản</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Hồ sơ đăng nhập dashboard. Đổi mật khẩu và email OTP ở đây — không nằm trong Quản lý người dùng.
        </p>
      </div>

      <Card className="p-5 sm:p-6 bg-card/80 border-border mb-6 overflow-hidden">
        <div className="flex items-start gap-4">
          <span className="w-14 h-14 rounded-full bg-gradient-to-tr from-primary to-amber-400 flex items-center justify-center text-white font-bold text-lg shrink-0 shadow-lg shadow-primary/20">
            {initials(user.username)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-white truncate">{user.username}</h2>
              <Badge variant="outline" className={`text-[11px] font-bold ${roleBadgeClass(user.role)}`}>
                {roleLabel(user.role)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5 min-w-0">
              <Mail className="w-3.5 h-3.5 shrink-0" />
              {displayEmail ? (
                <span className="truncate">{displayEmail}</span>
              ) : (
                <span className="text-amber-300">Chưa gắn email</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{roleBlurb(user.role)}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-muted-foreground">
              {workspaceName ? (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  {workspaceName}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <Shield className="w-3 h-3" />
                {deploymentModeLabel(user.deployment_mode)}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {!displayEmail ? (
        <div className="mb-6 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-100/90 leading-relaxed">
            Chưa có email. Quên mật khẩu sẽ không nhận được OTP — gắn email ở mục hồ sơ bên dưới.
          </p>
        </div>
      ) : null}

      <section className="mb-8">
        <h3 className="text-sm font-semibold text-white mb-3">Hồ sơ</h3>
        <Card className="p-5 sm:p-6 bg-card/80 border-border">
          <form onSubmit={(ev) => void onSaveInfo(ev)} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="profile-username">Tên đăng nhập</Label>
              <Input
                id="profile-username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearOneFieldError(setInfoErrors, 'username');
                }}
                autoComplete="username"
                className={fieldInputErrorClass(Boolean(infoErrors.username), 'bg-input border-border')}
              />
              <FieldError message={infoErrors.username} />
            </div>
            <div>
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearOneFieldError(setInfoErrors, 'email');
                }}
                placeholder="vd. ban@congty.com"
                autoComplete="email"
                className={fieldInputErrorClass(Boolean(infoErrors.email), 'bg-input border-border')}
              />
              <FieldError message={infoErrors.email} />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                OTP quên mật khẩu gửi về địa chỉ này.
              </p>
            </div>

            {profileDirty ? (
              <div className="rounded-lg border border-border bg-slate-950/40 p-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Xác nhận bằng mật khẩu hiện tại rồi mới lưu thay đổi.
                </p>
                <div>
                  <Label>Mật khẩu hiện tại</Label>
                  <PasswordInput
                    value={infoPassword}
                    onChange={(v) => {
                      setInfoPassword(v);
                      clearOneFieldError(setInfoErrors, 'current_password');
                    }}
                    error={Boolean(infoErrors.current_password)}
                    autoComplete="current-password"
                  />
                  <FieldError message={infoErrors.current_password} />
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {profileDirty ? (
                <Button type="button" variant="ghost" onClick={resetProfile} disabled={infoBusy}>
                  Hủy
                </Button>
              ) : null}
              <Button type="submit" disabled={!profileDirty || infoBusy}>
                {infoBusy ? 'Đang lưu…' : 'Lưu hồ sơ'}
              </Button>
            </div>
          </form>
        </Card>
      </section>

      <section className="mb-8">
        <h3 className="text-sm font-semibold text-white mb-3">Bảo mật</h3>
        <Card className="p-5 sm:p-6 bg-card/80 border-border">
          {!changingPassword ? (
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3 min-w-0">
                <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <KeyRound className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">Mật khẩu đăng nhập</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    Đổi xong phiên hiện tại hết hạn — phải đăng nhập lại.
                  </p>
                </div>
              </div>
              <Button type="button" variant="outline" className="shrink-0" onClick={() => setChangingPassword(true)}>
                Đổi mật khẩu
              </Button>
            </div>
          ) : (
            <form onSubmit={(ev) => void onChangePassword(ev)} className="space-y-4" noValidate>
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-100/80 leading-relaxed">
                  Sau khi đổi, cookie phiên bị thu hồi. Chuẩn bị mật khẩu mới trước khi bấm lưu.
                </p>
              </div>
              <div>
                <Label>Mật khẩu hiện tại</Label>
                <PasswordInput
                  value={loginPassword}
                  onChange={(v) => {
                    setLoginPassword(v);
                    clearOneFieldError(setPwErrors, 'current_password');
                  }}
                  error={Boolean(pwErrors.current_password)}
                  autoComplete="current-password"
                />
                <FieldError message={pwErrors.current_password} />
              </div>
              <div>
                <Label>Mật khẩu mới</Label>
                <PasswordInput
                  value={newPassword}
                  onChange={(v) => {
                    setNewPassword(v);
                    clearOneFieldError(setPwErrors, 'password');
                  }}
                  error={Boolean(pwErrors.password)}
                  autoComplete="new-password"
                />
                <FieldError message={pwErrors.password} />
              </div>
              <div>
                <Label>Nhập lại mật khẩu mới</Label>
                <PasswordInput
                  value={confirmPassword}
                  onChange={(v) => {
                    setConfirmPassword(v);
                    clearOneFieldError(setPwErrors, 'confirm_password');
                  }}
                  error={Boolean(pwErrors.confirm_password)}
                  autoComplete="new-password"
                />
                <FieldError message={pwErrors.confirm_password} />
              </div>
              {newPassword || confirmPassword ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <CheckLine ok={longEnough} label="Ít nhất 6 ký tự" />
                  <CheckLine ok={passwordsMatch} label="Hai lần nhập khớp" />
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                  Quên mật khẩu? Dùng OTP email
                </Link>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={closePasswordForm} disabled={pwBusy}>
                    Hủy
                  </Button>
                  <Button type="submit" disabled={pwBusy || !longEnough || !passwordsMatch || !loginPassword}>
                    {pwBusy ? 'Đang đổi…' : 'Lưu mật khẩu mới'}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </Card>
      </section>

    </div>

      {saas ? (
        <div className="max-w-3xl mt-2">
          <Separator className="mb-8" />
          <section>
            <h3 className="text-sm font-semibold text-white mb-1">Workspace</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Mời người đã có tài khoản vào workspace đang chọn. Chính bạn không hiện trong Quản lý người dùng.
            </p>
            <WorkspaceMembersPanel />
          </section>
        </div>
      ) : null}
    </div>
  );
}
