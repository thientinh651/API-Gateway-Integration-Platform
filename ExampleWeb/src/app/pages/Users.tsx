import { useState } from 'react';
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

interface User {
  id: string;
  username: string;
  role: 'Admin' | 'Operator' | 'Viewer';
  isActive: boolean;
  createdAt: string;
  lastLogin?: string;
}

export function Users() {
  const [users, setUsers] = useState<User[]>([
    {
      id: '1',
      username: 'admin',
      role: 'Admin',
      isActive: true,
      createdAt: '2026-05-01',
      lastLogin: '2026-05-14 10:30',
    },
    {
      id: '2',
      username: 'operator1',
      role: 'Operator',
      isActive: true,
      createdAt: '2026-05-05',
      lastLogin: '2026-05-14 09:15',
    },
    {
      id: '3',
      username: 'viewer1',
      role: 'Viewer',
      isActive: true,
      createdAt: '2026-05-10',
      lastLogin: '2026-05-13 16:45',
    },
    {
      id: '4',
      username: 'operator2',
      role: 'Operator',
      isActive: false,
      createdAt: '2026-05-12',
    },
  ]);

  const [isOpen, setIsOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    role: 'Viewer' as 'Admin' | 'Operator' | 'Viewer',
  });

  const handleCreate = () => {
    const newUser: User = {
      id: Date.now().toString(),
      username: formData.username,
      role: formData.role,
      isActive: true,
      createdAt: new Date().toISOString().split('T')[0],
    };
    setUsers([...users, newUser]);
    setIsOpen(false);
    resetForm();
    toast.success('User đã được tạo thành công');
  };

  const handleUpdate = () => {
    if (!editingUser) return;
    setUsers(
      users.map((u) =>
        u.id === editingUser.id
          ? { ...u, username: formData.username, role: formData.role }
          : u
      )
    );
    setIsOpen(false);
    setEditingUser(null);
    resetForm();
    toast.success('User đã được cập nhật');
  };

  const handleDelete = (id: string) => {
    const user = users.find((u) => u.id === id);
    if (user?.username === 'admin') {
      toast.error('Không thể xóa tài khoản admin chính');
      return;
    }
    setUsers(users.filter((u) => u.id !== id));
    toast.success('User đã được xóa');
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '',
      role: user.role,
    });
    setIsOpen(true);
  };

  const handleToggleActive = (id: string) => {
    const user = users.find((u) => u.id === id);
    if (user?.username === 'admin') {
      toast.error('Không thể vô hiệu hóa tài khoản admin chính');
      return;
    }
    setUsers(users.map((u) => (u.id === id ? { ...u, isActive: !u.isActive } : u)));
    const updatedUser = users.find((u) => u.id === id);
    toast.success(
      `User "${updatedUser?.username}" đã được ${updatedUser?.isActive ? 'vô hiệu hóa' : 'kích hoạt'}`
    );
  };

  const resetForm = () => {
    setFormData({ username: '', password: '', role: 'Viewer' });
  };

  const handleDialogClose = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setEditingUser(null);
      resetForm();
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'Admin':
        return <Shield className="w-4 h-4" />;
      case 'Operator':
        return <UserCog className="w-4 h-4" />;
      case 'Viewer':
        return <Eye className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'Admin':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'Operator':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'Viewer':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      default:
        return '';
    }
  };

  return (
    <>
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Quản lý Users</h1>
          <p className="text-muted-foreground">
            Quản lý tài khoản admin và phân quyền RBAC
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
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="bg-input border-border text-foreground"
                  disabled={editingUser?.username === 'admin'}
                />
              </div>
              <div>
                <Label className="text-foreground">
                  Password {editingUser && '(để trống nếu không đổi)'}
                </Label>
                <Input
                  type="password"
                  placeholder="********"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="bg-input border-border text-foreground"
                />
              </div>
              <div>
                <Label className="text-foreground">Role</Label>
                <Select
                  value={formData.role}
                  onValueChange={(v: 'Admin' | 'Operator' | 'Viewer') =>
                    setFormData({ ...formData, role: v })
                  }
                  disabled={editingUser?.username === 'admin'}
                >
                  <SelectTrigger className="bg-input border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="Admin">Admin (Full access)</SelectItem>
                    <SelectItem value="Operator">Operator (CRUD routes/keys)</SelectItem>
                    <SelectItem value="Viewer">Viewer (Read only)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <p className="text-xs text-amber-400">
                  <strong>Lưu ý:</strong> Admin có toàn quyền, Operator quản lý routes/keys,
                  Viewer chỉ xem.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={editingUser ? handleUpdate : handleCreate}
                  className="flex-1 bg-primary hover:bg-primary/90"
                  disabled={!formData.username || (!editingUser && !formData.password)}
                >
                  {editingUser ? 'Cập nhật' : 'Tạo'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleDialogClose(false)}
                  className="flex-1 border-border"
                >
                  Hủy
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Total Users
            </h3>
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Shield className="w-5 h-5 text-blue-500" />
            </div>
          </div>
          <p className="text-3xl font-bold text-white">{users.length}</p>
        </Card>
        <Card className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Active
            </h3>
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <Shield className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
          <p className="text-3xl font-bold text-white">
            {users.filter((u) => u.isActive).length}
          </p>
        </Card>
        <Card className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Admins
            </h3>
            <div className="p-2 bg-red-500/10 rounded-lg">
              <Shield className="w-5 h-5 text-red-500" />
            </div>
          </div>
          <p className="text-3xl font-bold text-white">
            {users.filter((u) => u.role === 'Admin').length}
          </p>
        </Card>
      </div>

      <Card className="rounded-2xl overflow-hidden bg-card/80 backdrop-blur-sm border-border">
        <div className="p-6 border-b border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider">
            Danh sách Users ({users.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
              <tr>
                <th className="px-6 py-4">Username</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Created</th>
                <th className="px-6 py-4">Last Login</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {users.map((user) => (
                <tr key={user.id} className="border-b border-border/50 hover:bg-primary/5">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300 font-medium">{user.username}</span>
                      {user.username === 'admin' && (
                        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 border text-xs">
                          Primary
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge
                      className={`${getRoleBadgeClass(user.role)} border flex items-center gap-1 w-fit`}
                    >
                      {getRoleIcon(user.role)}
                      {user.role}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-slate-400">{user.createdAt}</td>
                  <td className="px-6 py-4 text-slate-400">
                    {user.lastLogin || 'Never'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={user.isActive}
                        onCheckedChange={() => handleToggleActive(user.id)}
                        disabled={user.username === 'admin'}
                      />
                      <span
                        className={`text-xs font-bold ${
                          user.isActive ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(user)}
                        className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(user.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        disabled={user.username === 'admin'}
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
