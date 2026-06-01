import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
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
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  updateAdminUser,
  type AdminUserRow,
} from '../../lib/api';
import { canManageUsers } from '../../lib/rbac';
import { formatDbTimestamp } from '../../lib/formatDbTimestamp';
import { toastApiError } from '../../lib/apiClientError';
import {
  clearOneFieldError,
  failClientValidation,
  fieldInputErrorClass,
  handleFormApiError,
} from '../../lib/formValidation';
import { FieldError } from '../components/forms/FieldError';

function displayRole(role: string): string {
  const r = role.toLowerCase();
  if (r === 'admin') return 'Admin';
  if (r === 'operator') return 'Operator';
  return 'Viewer';
}

function apiRole(ui: string): string {
  return ui.toLowerCase();
}

function UsersAdmin() {
  const { user: me } = useAdminAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserRow | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    role: 'Viewer' as 'Admin' | 'Operator' | 'Viewer',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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

  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!formData.username.trim()) {
      errors.username = 'Nhập username';
    }
    if (!editingUser && formData.password.length < 6) {
      errors.password = 'Mật khẩu tối thiểu 6 ký tự';
    }
    if (editingUser && formData.password.trim() && formData.password.trim().length < 6) {
      errors.password = 'Mật khẩu tối thiểu 6 ký tự';
    }
    return errors;
  };

  const handleCreate = async () => {
    const clientErrors = validateForm();
    if (Object.keys(clientErrors).length > 0) {
      failClientValidation(setFieldErrors, clientErrors);
      return;
    }
    try {
      await createAdminUser({
        username: formData.username.trim(),
        password: formData.password,
        role: apiRole(formData.role),
      });
      await load();
      setIsOpen(false);
      resetForm();
      setFieldErrors({});
      toast.success('User đã được tạo');
    } catch (e) {
      handleFormApiError(e, setFieldErrors);
    }
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    const clientErrors = validateForm();
    if (Object.keys(clientErrors).length > 0) {
      failClientValidation(setFieldErrors, clientErrors);
      return;
    }
    try {
      await updateAdminUser(editingUser.id, {
        username: formData.username.trim(),
        role: apiRole(formData.role),
        is_active: editingUser.is_active,
        password: formData.password.trim() || undefined,
      });
      await load();
      setIsOpen(false);
      setEditingUser(null);
      resetForm();
      setFieldErrors({});
      toast.success('User đã được cập nhật');
    } catch (e) {
      handleFormApiError(e, setFieldErrors);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteAdminUser(id);
      await load();
      toast.success('User đã được xóa');
    } catch (e) {
      toastApiError(e);
    }
  };

  const handleEdit = (user: AdminUserRow) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '',
      role: displayRole(user.role) as 'Admin' | 'Operator' | 'Viewer',
    });
    setIsOpen(true);
  };

  const handleToggleActive = async (user: AdminUserRow) => {
    try {
      await updateAdminUser(user.id, {
        username: user.username,
        role: user.role,
        is_active: !user.is_active,
      });
      await load();
      toast.success(user.is_active ? 'Đã vô hiệu hóa' : 'Đã kích hoạt');
    } catch (e) {
      toastApiError(e);
    }
  };

  const resetForm = () => {
    setFormData({ username: '', password: '', role: 'Viewer' });
    setFieldErrors({});
  };

  const handleDialogClose = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setEditingUser(null);
      resetForm();
    }
  };

  const getRoleIcon = (role: string) => {
    switch (displayRole(role)) {
      case 'Admin':
        return <Shield className="w-4 h-4" />;
      case 'Operator':
        return <UserCog className="w-4 h-4" />;
      default:
        return <Eye className="w-4 h-4" />;
    }
  };

  const getRoleBadgeClass = (role: string) => {
    switch (displayRole(role)) {
      case 'Admin':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'Operator':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      default:
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    }
  };

  if (!canManageUsers(me)) {
    return (
      <p className="text-muted-foreground">
        Chỉ role <strong className="text-foreground">admin</strong> quản lý user dashboard. Operator/viewer
        không truy cập trang này.
      </p>
    );
  }

  return (
    <>
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Quản lý Users</h1>
          <p className="text-muted-foreground">
            Tài khoản đăng nhập dashboard (Argon2). Khác API key cấp cho phần mềm.
          </p>
        </div>
        <Dialog open={isOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" />
              Thêm User
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-white">
                {editingUser ? 'Chỉnh sửa User' : 'Tạo User mới'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label className="text-foreground">Username</Label>
                <Input
                  placeholder="username"
                  value={formData.username}
                  onChange={(e) => {
                    setFormData({ ...formData, username: e.target.value });
                    clearOneFieldError(setFieldErrors, 'username');
                  }}
                  aria-invalid={Boolean(fieldErrors.username)}
                  className={fieldInputErrorClass(Boolean(fieldErrors.username), 'bg-input border-border text-foreground')}
                  autoComplete="off"
                />
                <FieldError message={fieldErrors.username} />
              </div>
              <div>
                <Label className="text-foreground">
                  Password {editingUser && '(để trống nếu không đổi)'}
                </Label>
                <Input
                  type="password"
                  placeholder="********"
                  value={formData.password}
                  onChange={(e) => {
                    setFormData({ ...formData, password: e.target.value });
                    clearOneFieldError(setFieldErrors, 'password');
                  }}
                  aria-invalid={Boolean(fieldErrors.password)}
                  className={fieldInputErrorClass(Boolean(fieldErrors.password), 'bg-input border-border text-foreground')}
                  autoComplete="new-password"
                />
                <FieldError message={fieldErrors.password} />
              </div>
              <div>
                <Label className="text-foreground">Role</Label>
                <Select
                  value={formData.role}
                  onValueChange={(v: 'Admin' | 'Operator' | 'Viewer') => {
                    setFormData({ ...formData, role: v });
                    clearOneFieldError(setFieldErrors, 'role');
                  }}
                >
                  <SelectTrigger className="bg-input border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="Admin">Admin — full</SelectItem>
                    <SelectItem value="Operator">Operator — key, sửa route (không tạo route)</SelectItem>
                    <SelectItem value="Viewer">Viewer — chỉ đọc</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError message={fieldErrors.role} />
              </div>
              <Button
                onClick={() => void (editingUser ? handleUpdate() : handleCreate())}
                className="w-full bg-primary hover:bg-primary/90"
                disabled={!formData.username || (!editingUser && formData.password.length < 6)}
              >
                {editingUser ? 'Cập nhật' : 'Tạo'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="rounded-2xl overflow-hidden bg-card/80 backdrop-blur-sm border-border">
        <div className="p-6 border-b border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider">
            Danh sách Users ({loading ? '…' : users.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
              <tr>
                <th className="px-6 py-4">Username</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Created</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {users.map((user) => (
                <tr key={user.id} className="border-b border-border/50 hover:bg-primary/5">
                  <td className="px-6 py-4 text-slate-300 font-medium">{user.username}</td>
                  <td className="px-6 py-4">
                    <Badge
                      className={`${getRoleBadgeClass(user.role)} border flex items-center gap-1 w-fit`}
                    >
                      {getRoleIcon(user.role)}
                      {displayRole(user.role)}
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDelete(user.id)}
                        className="text-red-400"
                        disabled={me?.user_id === user.id}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
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
    <AdminOnly title="Quản lý Users" description="Đăng nhập admin để quản lý tài khoản dashboard.">
      <UsersAdmin />
    </AdminOnly>
  );
}
