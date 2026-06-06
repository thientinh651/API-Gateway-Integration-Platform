import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { adminMe, updateAdminProfile } from '../../lib/api';
import { roleBadgeClass, roleDescription, roleLabel } from '../../lib/rbac';
import { TechPageHeader } from '../components/tech/TechPageHeader';
import { FieldError } from '../components/forms/FieldError';
import {
  clearOneFieldError,
  failClientValidation,
  fieldInputErrorClass,
  handleFormApiError,
} from '../../lib/formValidation';

export function Profile() {
  const navigate = useNavigate();
  const { user, refresh, clearUser } = useAdminAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [savedEmail, setSavedEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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

  const onSaveInfo = async (e: FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!username.trim()) errors.username = 'Nhập tên đăng nhập';
    const usernameChanged = username.trim() !== user.username;
    const emailNorm = email.trim().toLowerCase();
    const emailChanged = emailNorm !== savedEmail.trim().toLowerCase();
    if (!usernameChanged && !emailChanged) {
      errors.username = 'Không có thay đổi';
    }
    if ((usernameChanged || emailChanged) && !currentPassword) {
      errors.current_password = 'Nhập mật khẩu hiện tại để xác nhận';
    }
    if (Object.keys(errors).length > 0) {
      failClientValidation(setFieldErrors, errors);
      return;
    }
    setBusy(true);
    setFieldErrors({});
    try {
      await updateAdminProfile({
        username: usernameChanged ? username.trim() : undefined,
        email: email.trim(),
        current_password: currentPassword,
      });
      await refresh();
      setSavedEmail(email.trim().toLowerCase());
      setCurrentPassword('');
      toast.success('Đã cập nhật thông tin.');
    } catch (err) {
      handleFormApiError(err, setFieldErrors);
    } finally {
      setBusy(false);
    }
  };

  const onChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!currentPassword) errors.current_password = 'Nhập mật khẩu hiện tại';
    if (newPassword.length < 6) errors.password = 'Mật khẩu mới tối thiểu 6 ký tự';
    if (newPassword !== confirmPassword) errors.confirm_password = 'Mật khẩu xác nhận không khớp';
    if (Object.keys(errors).length > 0) {
      failClientValidation(setFieldErrors, errors);
      return;
    }
    setBusy(true);
    setFieldErrors({});
    try {
      const res = await updateAdminProfile({
        password: newPassword,
        current_password: currentPassword,
      });
      if (res.password_changed) {
        clearUser();
        toast.success('Đã đổi mật khẩu — đăng nhập lại.');
        navigate('/login');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Đã đổi mật khẩu.');
    } catch (err) {
      handleFormApiError(err, setFieldErrors);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TechPageHeader
        codeLine="// profile · self-service"
        title="Tài khoản của tôi"
        description="Cập nhật thông tin và mật khẩu. Email dùng cho quên mật khẩu (OTP)."
      />

      <div className="max-w-xl">
        <Card className="p-4 sm:p-6 bg-card/80 border-border mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-white font-semibold">{user.username}</span>
            <Badge variant="outline" className={`text-[11px] font-bold ${roleBadgeClass(user.role)}`}>
              {roleLabel(user.role)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{roleDescription(user.role)}</p>
        </Card>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="info">Thông tin</TabsTrigger>
            <TabsTrigger value="password">Mật khẩu</TabsTrigger>
          </TabsList>

          <TabsContent value="info">
            <Card className="p-6 bg-card/80 border-border">
              <form onSubmit={(ev) => void onSaveInfo(ev)} className="space-y-4" noValidate>
                <div>
                  <Label>Tên đăng nhập</Label>
                  <Input
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      clearOneFieldError(setFieldErrors, 'username');
                    }}
                    autoComplete="username"
                    className={fieldInputErrorClass(Boolean(fieldErrors.username), 'bg-input border-border')}
                  />
                  <FieldError message={fieldErrors.username} />
                </div>
                <div>
                  <Label>Email (OTP quên mật khẩu)</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearOneFieldError(setFieldErrors, 'email');
                    }}
                    placeholder="you@company.com"
                    autoComplete="email"
                    className={fieldInputErrorClass(Boolean(fieldErrors.email), 'bg-input border-border')}
                  />
                  <FieldError message={fieldErrors.email} />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Bắt buộc nếu dùng{' '}
                    <Link to="/forgot-password" className="text-primary underline">
                      quên mật khẩu
                    </Link>
                    .
                  </p>
                </div>
                <div>
                  <Label>Mật khẩu hiện tại (xác nhận)</Label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value);
                      clearOneFieldError(setFieldErrors, 'current_password');
                    }}
                    autoComplete="current-password"
                    className={fieldInputErrorClass(
                      Boolean(fieldErrors.current_password),
                      'bg-input border-border'
                    )}
                  />
                  <FieldError message={fieldErrors.current_password} />
                </div>
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? 'Đang lưu…' : 'Lưu thông tin'}
                </Button>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="password">
            <Card className="p-6 bg-card/80 border-border">
              <form onSubmit={(ev) => void onChangePassword(ev)} className="space-y-4" noValidate>
                <div>
                  <Label>Mật khẩu hiện tại</Label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value);
                      clearOneFieldError(setFieldErrors, 'current_password');
                    }}
                    autoComplete="current-password"
                    className={fieldInputErrorClass(
                      Boolean(fieldErrors.current_password),
                      'bg-input border-border'
                    )}
                  />
                  <FieldError message={fieldErrors.current_password} />
                </div>
                <div>
                  <Label>Mật khẩu mới</Label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      clearOneFieldError(setFieldErrors, 'password');
                    }}
                    autoComplete="new-password"
                    className={fieldInputErrorClass(Boolean(fieldErrors.password), 'bg-input border-border')}
                  />
                  <FieldError message={fieldErrors.password} />
                </div>
                <div>
                  <Label>Xác nhận mật khẩu mới</Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      clearOneFieldError(setFieldErrors, 'confirm_password');
                    }}
                    autoComplete="new-password"
                    className={fieldInputErrorClass(
                      Boolean(fieldErrors.confirm_password),
                      'bg-input border-border'
                    )}
                  />
                  <FieldError message={fieldErrors.confirm_password} />
                </div>
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? 'Đang đổi…' : 'Đổi mật khẩu'}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  <Link to="/forgot-password" className="text-primary underline">
                    Quên mật khẩu? Dùng OTP email
                  </Link>
                </p>
              </form>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
