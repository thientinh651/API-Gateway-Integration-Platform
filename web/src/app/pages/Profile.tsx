import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { adminMe, updateAdminProfile } from '../../lib/api';
import { roleBadgeClass, roleLabel } from '../../lib/rbac';
import { WorkspaceMembersPanel } from '../components/workspace/WorkspaceMembersPanel';
import { currentWorkspaceName, isSaasMode } from '../../lib/deployment';
import { FieldError } from '../components/forms/FieldError';
import {
  clearOneFieldError,
  failClientValidation,
  fieldInputErrorClass,
  handleFormApiError,
  isValidEmail,
} from '../../lib/formValidation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase().slice(0, 2);
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5"
    >
      {children}
    </label>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  error,
  autoComplete,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className={fieldInputErrorClass(Boolean(error), 'bg-input border-border pr-10 h-9')}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
      >
        {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
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
  const [passwordOpen, setPasswordOpen] = useState(false);
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
        </button>
      </p>
    );
  }

  const resetProfile = () => {
    setUsername(user.username);
    setEmail(savedEmail);
    setInfoPassword('');
    setInfoErrors({});
  };

  const resetPasswordForm = () => {
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
    if (emailTrimmed && !isValidEmail(emailTrimmed)) errors.email = 'Email không hợp lệ';
    if (!infoPassword) errors.current_password = 'Nhập mật khẩu hiện tại';
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
    if (!longEnough) errors.password = 'Tối thiểu 6 ký tự';
    if (!passwordsMatch) errors.confirm_password = 'Chưa khớp';
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
        toast.success('Đã đổi mật khẩu — đăng nhập lại.');
        navigate('/login');
        return;
      }
      resetPasswordForm();
      setPasswordOpen(false);
      toast.success('Đã đổi mật khẩu.');
    } catch (err) {
      handleFormApiError(err, setPwErrors);
    } finally {
      setPwBusy(false);
    }
  };

  const saas = isSaasMode(user.deployment_mode);

  return (
    <div className="w-full max-w-5xl">
      <header className="mb-4">
        <h1 className="text-3xl font-bold text-white tracking-tight leading-none">Tài khoản</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Quản lý thông tin tài khoản và bảo mật workspace
        </p>
      </header>

      <Card className="bg-card/80 border-border p-4 sm:p-5">
        <form onSubmit={(ev) => void onSaveInfo(ev)} className="space-y-4" noValidate>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-11 h-11 rounded-full bg-gradient-to-tr from-primary to-amber-400 flex items-center justify-center text-white font-bold text-sm shrink-0">
                {initials(user.username)}
              </span>
              <div className="min-w-0">
                <p className="text-lg font-semibold text-white leading-tight truncate">{user.username}</p>
                <Badge
                  variant="outline"
                  className={`mt-1 text-[10px] font-bold ${roleBadgeClass(user.role)}`}
                >
                  {roleLabel(user.role)}
                </Badge>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setPasswordOpen(true)}>
              <KeyRound className="w-4 h-4" />
              Đổi mật khẩu
            </Button>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px] gap-3">
            <div>
              <FieldLabel htmlFor="profile-username">Tên đăng nhập</FieldLabel>
              <Input
                id="profile-username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearOneFieldError(setInfoErrors, 'username');
                }}
                autoComplete="username"
                className={fieldInputErrorClass(Boolean(infoErrors.username), 'bg-input border-border h-9')}
              />
              <FieldError message={infoErrors.username} />
            </div>

            <div>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearOneFieldError(setInfoErrors, 'email');
                }}
                placeholder="Chưa gắn"
                autoComplete="email"
                className={fieldInputErrorClass(Boolean(infoErrors.email), 'bg-input border-border h-9')}
              />
              <FieldError message={infoErrors.email} />
            </div>

            <div>
              <FieldLabel>Workspace</FieldLabel>
              <p className="h-9 flex items-center text-sm text-white px-3 rounded-md border border-border bg-slate-950/40">
                {workspaceName ?? 'default'}
              </p>
            </div>
          </div>

          {profileDirty ? (
            <div className="grid lg:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
              <div>
                <FieldLabel>Xác nhận mật khẩu</FieldLabel>
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
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={resetProfile} disabled={infoBusy}>
                  Hủy
                </Button>
                <Button type="submit" size="sm" disabled={infoBusy}>
                  {infoBusy ? 'Đang lưu…' : 'Lưu hồ sơ'}
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      </Card>

      <Dialog
        open={passwordOpen}
        onOpenChange={(open) => {
          setPasswordOpen(open);
          if (!open) resetPasswordForm();
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Đổi mật khẩu</DialogTitle>
            <DialogDescription className="text-xs">
              Lưu xong sẽ đăng nhập lại.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(ev) => void onChangePassword(ev)} className="space-y-4" noValidate>
            <div>
              <FieldLabel htmlFor="pw-current">Mật khẩu hiện tại</FieldLabel>
              <PasswordInput
                id="pw-current"
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
              <FieldLabel htmlFor="pw-new">Mật khẩu mới</FieldLabel>
              <PasswordInput
                id="pw-new"
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
              <FieldLabel htmlFor="pw-confirm">Nhập lại</FieldLabel>
              <PasswordInput
                id="pw-confirm"
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

            <DialogFooter className="items-center sm:justify-between">
              <Link to="/forgot-password" className="text-[11px] text-primary hover:underline">
                Quên mật khẩu
              </Link>
              <Button
                type="submit"
                size="sm"
                disabled={pwBusy || !longEnough || !passwordsMatch || !loginPassword}
              >
                {pwBusy ? 'Đang lưu…' : 'Lưu mật khẩu'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {saas ? (
        <div className="mt-6">
          <WorkspaceMembersPanel />
        </div>
      ) : null}
    </div>
  );
}
