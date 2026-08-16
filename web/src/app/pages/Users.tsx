import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { ConfirmDangerButton } from '../components/forms/ConfirmDangerButton';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Plus, Edit, Trash2, Shield, UserCog, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { AdminOnly } from '../components/auth/AdminOnly';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { useUndoDelete } from '../../contexts/UndoDeleteContext';
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  updateAdminUser,
  type AdminUserRow,
} from '../../lib/api';
import { roleLabel } from '../../lib/rbac';
import { isSaasMode } from '../../lib/deployment';
import { formatDbTimestamp } from '../../lib/formatDbTimestamp';
import { toastApiError } from '../../lib/apiClientError';
import {
  clearOneFieldError,
  failClientValidation,
  fieldInputErrorClass,
  handleFormApiError,
  isValidEmail,
} from '../../lib/formValidation';
import { FieldError } from '../components/forms/FieldError';
import { EnterSubmitForm } from '../components/forms/EnterSubmitForm';

type UiRole = 'Admin' | 'Operator' | 'Viewer';

function uiRoleFromApi(role: string): UiRole {
  const r = role.toLowerCase();
  if (r === 'admin') return 'Admin';
  if (r === 'operator') return 'Operator';
  return 'Viewer';
}

function apiRole(ui: string): string {
  return ui.toLowerCase();
}

type FormData = {
  username: string;
  email: string;
  password: string;
  current_password: string;
  role: UiRole;
};

const EMPTY_FORM: FormData = {
  username: '',
  email: '',
  password: '',
  current_password: '',
  role: 'Viewer',
};

function UsersAdmin() {
  const { user: me } = useAdminAuth();
  const { scheduleDelete, pendingIdSet, undoSeconds } = useUndoDelete();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserRow | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const editingSelf = editingUser != null && me?.user_id === editingUser.id;
  const hiddenUserIds = pendingIdSet('user');
  const visibleUsers = useMemo(
    () => users.filter((u) => !hiddenUserIds.has(String(u.id))),
    [users, hiddenUserIds],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await fetchAdminUsers());
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const validateForm = useCallback(
    (data: FormData): Record<string, string> => {
      const errors: Record<string, string> = {};
      if (!data.username.trim()) {
        errors.username = 'Nhập username';
      }
      if (!editingUser) {
        if (data.password.length < 6) {
          errors.password = 'Mật khẩu tối thiểu 6 ký tự';
        }
      } else if (data.password.trim()) {
        if (data.password.trim().length < 6) {
          errors.password = 'Mật khẩu tối thiểu 6 ký tự';
        }
        if (editingSelf && !data.current_password.trim()) {
          errors.current_password = 'Nhập mật khẩu hiện tại';
        }
      } else if (editingSelf && data.current_password.trim() && !data.password.trim()) {
        errors.password = 'Nhập mật khẩu mới';
      }
      if (data.email.trim() && !isValidEmail(data.email.trim())) {
        errors.email = 'Email không hợp lệ';
      }
      return errors;
    },
    [editingUser, editingSelf],
  );

  const isDirty = useMemo(() => {
    if (!editingUser) return true;
    const origEmail = editingUser.email ?? '';
    if (formData.username.trim() !== editingUser.username) return true;
    if (formData.email.trim() !== origEmail) return true;
    if (formData.password.trim()) return true;
    if (!editingSelf && formData.role !== uiRoleFromApi(editingUser.role)) return true;
    return false;
  }, [editingUser, editingSelf, formData]);

  const clientErrors = useMemo(() => validateForm(formData), [validateForm, formData]);
  const formValid = Object.keys(clientErrors).length === 0;
  const canSubmit = editingUser ? isDirty && formValid && !saving : formValid && !saving;

  const showFieldHints =
    attempted ||
    (editingUser ? isDirty : formData.username.length > 0 || formData.password.length > 0 || formData.email.length > 0);

  const displayErrors = useMemo(() => {
    if (!showFieldHints) return fieldErrors;
    return { ...fieldErrors, ...clientErrors };
  }, [showFieldHints, fieldErrors, clientErrors]);

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setFieldErrors({});
    setAttempted(false);
  };

  const patchForm = (patch: Partial<FormData>, clearKey?: string) => {
    setFormData((prev) => ({ ...prev, ...patch }));
    if (clearKey) clearOneFieldError(setFieldErrors, clearKey);
  };

  const handleCreate = async () => {
    setAttempted(true);
    const errors = validateForm(formData);
    if (Object.keys(errors).length > 0) {
      failClientValidation(setFieldErrors, errors);
      return;
    }
    setSaving(true);
    try {
      const created = await createAdminUser({
        username: formData.username.trim(),
        password: formData.password,
        role: apiRole(formData.role),
        email: formData.email.trim() || undefined,
      });
      setUsers((prev) => {
        if (prev.some((u) => u.id === created.id)) return prev;
        return [...prev, created].sort((a, b) => a.username.localeCompare(b.username));
      });
      await load();
      setIsOpen(false);
      resetForm();
      toast.success(`Đã thêm "${created.username}" (${roleLabel(created.role)})`);
    } catch (e) {
      handleFormApiError(e, setFieldErrors);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    setAttempted(true);
    const errors = validateForm(formData);
    if (Object.keys(errors).length > 0) {
      failClientValidation(setFieldErrors, errors);
      return;
    }
    if (!isDirty) return;
    setSaving(true);
    try {
      const newPassword = formData.password.trim() || undefined;
      // Role: không gửi đổi khi tự sửa — luôn giữ role hiện tại.
      const roleToSave = editingSelf
        ? editingUser.role
        : apiRole(formData.role);
      const updated = await updateAdminUser(editingUser.id, {
        username: formData.username.trim(),
        role: roleToSave,
        is_active: editingUser.is_active,
        password: newPassword,
        current_password:
          editingSelf && newPassword ? formData.current_password : undefined,
        email: formData.email.trim(),
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      await load();
      setIsOpen(false);
      setEditingUser(null);
      resetForm();
      toast.success('User đã được cập nhật');
    } catch (e) {
      handleFormApiError(e, setFieldErrors);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: number) => {
    const row = users.find((u) => u.id === id);
    const label = row ? `user ${row.username}` : `user #${id}`;
    scheduleDelete({
      entity: 'user',
      id,
      label,
      execute: async () => {
        await deleteAdminUser(id);
        await load();
      },
    });
  };

  const handleEdit = (user: AdminUserRow) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      email: user.email ?? '',
      password: '',
      current_password: '',
      role: uiRoleFromApi(user.role),
    });
    setFieldErrors({});
    setAttempted(false);
    setIsOpen(true);
  };

  const handleToggleActive = async (user: AdminUserRow) => {
    try {
      await updateAdminUser(user.id, {
        username: user.username,
        role: user.role,
        is_active: !user.is_active,
        email: user.email ?? '',
      });
      await load();
      toast.success(user.is_active ? 'Đã vô hiệu hóa' : 'Đã kích hoạt');
    } catch (e) {
      toastApiError(e);
    }
  };

  const handleDialogClose = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setEditingUser(null);
      resetForm();
    }
  };

  const getRoleIcon = (role: string) => {
    switch (uiRoleFromApi(role)) {
      case 'Admin':
        return <Shield className="w-4 h-4" />;
      case 'Operator':
        return <UserCog className="w-4 h-4" />;
      default:
        return <Eye className="w-4 h-4" />;
    }
  };

  const getRoleBadgeClass = (role: string) => {
    switch (uiRoleFromApi(role)) {
      case 'Admin':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'Operator':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      default:
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    }
  };

  return (
    <>
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Quản lý người dùng</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Tạo và quản lý tài khoản dashboard.
            {isSaasMode(me?.deployment_mode) ? (
              <>
                {' '}
                Mời collaborator đã có tài khoản tại{' '}
                <span className="text-slate-300">Tài khoản → Workspace</span>.
              </>
            ) : null}
          </p>
        </div>
        <Dialog open={isOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={() => {
                setEditingUser(null);
                resetForm();
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Thêm thành viên
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-white">
                {editingUser ? 'Chỉnh sửa User' : 'Thêm User'}
              </DialogTitle>
            </DialogHeader>
            <EnterSubmitForm
              className="space-y-4 mt-4"
              disabled={!canSubmit}
              onSubmit={() => void (editingUser ? handleUpdate() : handleCreate())}
            >
              <div>
                <Label className="text-foreground">Username</Label>
                <Input
                  placeholder="username"
                  value={formData.username}
                  onChange={(e) => patchForm({ username: e.target.value }, 'username')}
                  aria-invalid={Boolean(displayErrors.username)}
                  className={fieldInputErrorClass(
                    Boolean(displayErrors.username),
                    'bg-input border-border text-foreground'
                  )}
                  autoComplete="off"
                />
                <FieldError message={displayErrors.username} />
              </div>
              <div>
                <Label className="text-foreground">Email</Label>
                <Input
                  type="email"
                  placeholder="user@company.com"
                  value={formData.email}
                  onChange={(e) => patchForm({ email: e.target.value }, 'email')}
                  aria-invalid={Boolean(displayErrors.email)}
                  className={fieldInputErrorClass(
                    Boolean(displayErrors.email),
                    'bg-input border-border text-foreground'
                  )}
                  autoComplete="off"
                />
                <FieldError message={displayErrors.email} />
              </div>
              {editingSelf ? (
                <div>
                  <Label className="text-foreground">Mật khẩu hiện tại</Label>
                  <Input
                    type="password"
                    placeholder="********"
                    value={formData.current_password}
                    onChange={(e) =>
                      patchForm({ current_password: e.target.value }, 'current_password')
                    }
                    aria-invalid={Boolean(displayErrors.current_password)}
                    className={fieldInputErrorClass(
                      Boolean(displayErrors.current_password),
                      'bg-input border-border text-foreground'
                    )}
                    autoComplete="current-password"
                  />
                  <FieldError message={displayErrors.current_password} />
                </div>
              ) : null}
              <div>
                <Label className="text-foreground">
                  {editingUser ? 'Mật khẩu mới' : 'Password'}
                </Label>
                <Input
                  type="password"
                  placeholder="********"
                  value={formData.password}
                  onChange={(e) => {
                    const password = e.target.value;
                    setFormData((prev) => ({ ...prev, password }));
                    clearOneFieldError(setFieldErrors, 'password');
                    if (!password.trim()) {
                      clearOneFieldError(setFieldErrors, 'current_password');
                    }
                  }}
                  aria-invalid={Boolean(displayErrors.password)}
                  className={fieldInputErrorClass(
                    Boolean(displayErrors.password),
                    'bg-input border-border text-foreground'
                  )}
                  autoComplete="new-password"
                />
                <FieldError message={displayErrors.password} />
              </div>
              <div>
                <Label className="text-foreground">Role</Label>
                {editingSelf ? (
                  <>
                    <div className="h-9 px-3 flex items-center rounded-md border border-border bg-muted/40 text-sm text-slate-300">
                      {roleLabel(formData.role)}
                    </div>
                    <FieldError message={displayErrors.role} />
                  </>
                ) : (
                  <>
                    <Select
                      value={formData.role}
                      onValueChange={(v: UiRole) => patchForm({ role: v }, 'role')}
                    >
                      <SelectTrigger
                        className={fieldInputErrorClass(
                          Boolean(displayErrors.role),
                          'bg-input border-border text-foreground'
                        )}
                        aria-invalid={Boolean(displayErrors.role)}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="Admin">Admin — full</SelectItem>
                        <SelectItem value="Operator">Operator — key, sửa route</SelectItem>
                        <SelectItem value="Viewer">Viewer — chỉ đọc</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldError message={displayErrors.role} />
                  </>
                )}
              </div>
              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90"
                disabled={!canSubmit}
              >
                {saving ? 'Đang lưu…' : editingUser ? 'Cập nhật' : 'Tạo'}
              </Button>
            </EnterSubmitForm>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="rounded-2xl overflow-hidden bg-card/80 backdrop-blur-sm border-border">
        <div className="p-6 border-b border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider">
            Quản lý người dùng ({loading ? '…' : users.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
              <tr>
                <th className="px-6 py-4">Username</th>
                <th className="px-6 py-4">Email</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Created</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {visibleUsers.map((user) => (
                <tr key={user.id} className="border-b border-border/50 hover:bg-primary/5">
                  <td className="px-6 py-4 text-slate-300 font-medium">{user.username}</td>
                  <td className="px-6 py-4 text-slate-400 text-xs">{user.email ?? '—'}</td>
                  <td className="px-6 py-4">
                    <Badge
                      className={`${getRoleBadgeClass(user.role)} border flex items-center gap-1 w-fit`}
                    >
                      {getRoleIcon(user.role)}
                      {roleLabel(user.role)}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-slate-400">{formatDbTimestamp(user.created_at)}</td>
                  <td className="px-6 py-4">
                    <Switch
                      checked={user.is_active}
                      onCheckedChange={() => void handleToggleActive(user)}
                      disabled={me?.user_id === user.id}
                    />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(user)}
                        className="text-blue-400"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <ConfirmDangerButton
                        title="Xóa user?"
                        description={
                          undoSeconds > 0
                            ? `Ẩn tài khoản "${user.username}". Có ${undoSeconds}s hoàn tác trước khi xóa thật.`
                            : `Xóa tài khoản "${user.username}".`
                        }
                        confirmLabel="Xóa user"
                        onConfirm={() => handleDelete(user.id)}
                        className="text-red-400"
                        disabled={me?.user_id === user.id}
                      >
                        <Trash2 className="w-4 h-4" />
                      </ConfirmDangerButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export function Users() {
  return (
    <AdminOnly title="Quản lý người dùng" description="Đăng nhập admin để quản lý tài khoản dashboard.">
      <UsersAdmin />
    </AdminOnly>
  );
}
