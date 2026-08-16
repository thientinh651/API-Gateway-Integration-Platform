import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import {
  fetchWorkspaceMembers,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  type AdminUserRow,
} from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
import { isSaasMode, currentWorkspaceName } from '../../../lib/deployment';
import { isAdmin, roleLabel } from '../../../lib/rbac';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';
import {
  clearOneFieldError,
  failClientValidation,
  fieldInputErrorClass,
  handleFormApiError,
} from '../../../lib/formValidation';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { ConfirmDangerButton } from '../forms/ConfirmDangerButton';
import { EnterSubmitForm } from '../forms/EnterSubmitForm';
import { FieldError } from '../forms/FieldError';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

function membershipKind(member: AdminUserRow, workspaceTenantId: number): 'owner' | 'collaborator' {
  return member.tenant_id === workspaceTenantId ? 'owner' : 'collaborator';
}

export function WorkspaceMembersPanel() {
  const { user } = useAdminAuth();
  const [members, setMembers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteRole, setInviteRole] = useState<'operator' | 'viewer'>('viewer');
  const [inviting, setInviting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const workspaceTenantId = user?.tenant_id ?? 1;
  const workspaceName = currentWorkspaceName(user) ?? `Workspace #${workspaceTenantId}`;
  const admin = isAdmin(user);

  const load = useCallback(async () => {
    if (!user || !isSaasMode(user.deployment_mode) || !admin) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setMembers(await fetchWorkspaceMembers());
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, [user, admin]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user || !isSaasMode(user.deployment_mode)) {
    return (
      <Card className="p-6 bg-card/80 border-border">
        <p className="text-sm text-muted-foreground">
          Quản lý thành viên nội bộ tại{' '}
          <Link to="/users" className="text-primary underline">
            Quản lý người dùng
          </Link>
          .
        </p>
      </Card>
    );
  }

  const onInvite = async () => {
    const username = inviteUsername.trim();
    const errors: Record<string, string> = {};
    if (!username) errors.username = 'Nhập username đã đăng ký';
    if (Object.keys(errors).length > 0) {
      failClientValidation(setFieldErrors, errors);
      return;
    }
    setInviting(true);
    setFieldErrors({});
    try {
      await inviteWorkspaceMember({ username, role: inviteRole });
      setInviteUsername('');
      await load();
      toast.success(`Đã mời "${username}" vào workspace`);
    } catch (e) {
      handleFormApiError(e, setFieldErrors);
    } finally {
      setInviting(false);
    }
  };

  const onRemove = async (member: AdminUserRow) => {
    try {
      await removeWorkspaceMember(member.id);
      await load();
      toast.success(`Đã gỡ "${member.username}" khỏi workspace`);
    } catch (e) {
      toastApiError(e);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-5 bg-card/80 border-border">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h3 className="text-sm font-semibold text-white">{workspaceName}</h3>
          <Badge variant="outline" className="text-[10px]">
            tenant #{workspaceTenantId}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Workspace riêng theo user — mời admin/operator/viewer đã có tài khoản. Chủ workspace quản lý
          thành viên nội bộ tại{' '}
          <Link to="/users" className="text-primary underline">
            Users
          </Link>
          .
        </p>
      </Card>

      {!admin ? (
        <Card className="p-5 bg-card/80 border-border">
          <p className="text-sm text-muted-foreground">
            Vai trò <strong className="text-slate-300">{roleLabel(user.role)}</strong> — chỉ Admin workspace
            mời/gỡ collaborator. Dùng menu workspace trên header để chuyển tổ chức.
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-5 bg-card/80 border-border">
            <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-primary" />
              Mời vào workspace
            </h4>
            <EnterSubmitForm
              className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end"
              disabled={inviting}
              onSubmit={() => void onInvite()}
            >
              <div>
                <Label className="text-foreground">Username (đã đăng ký)</Label>
                <Input
                  value={inviteUsername}
                  onChange={(e) => {
                    setInviteUsername(e.target.value);
                    clearOneFieldError(setFieldErrors, 'username');
                  }}
                  placeholder="colleague"
                  className={fieldInputErrorClass(
                    Boolean(fieldErrors.username),
                    'bg-input border-border text-foreground',
                  )}
                />
                <FieldError message={fieldErrors.username} />
              </div>
              <div className="sm:w-40">
                <Label className="text-foreground">Vai trò</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(v: 'operator' | 'viewer') => setInviteRole(v)}
                >
                  <SelectTrigger className="bg-input border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="operator">Operator</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="submit"
                className="bg-primary hover:bg-primary/90"
                disabled={inviting}
              >
                <Plus className="w-4 h-4 mr-1" />
                {inviting ? 'Đang mời…' : 'Mời'}
              </Button>
            </EnterSubmitForm>
            <p className="text-[11px] text-muted-foreground mt-2">
              User phải có tài khoản trước khi được mời.
            </p>
          </Card>

          <Card className="rounded-2xl overflow-hidden bg-card/80 border-border">
            <div className="p-5 border-b border-border">
              <h4 className="font-bold text-white text-sm uppercase tracking-wider">
                Thành viên ({loading ? '…' : members.length})
              </h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
                  <tr>
                    <th className="px-5 py-3">Username</th>
                    <th className="px-5 py-3">Loại</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {members.map((member) => {
                    const kind = membershipKind(member, workspaceTenantId);
                    const isSelf = member.id === user.user_id;
                    return (
                      <tr key={member.id} className="border-b border-border/50 hover:bg-primary/5">
                        <td className="px-5 py-3 text-slate-300 font-medium">{member.username}</td>
                        <td className="px-5 py-3">
                          <Badge
                            variant="outline"
                            className={
                              kind === 'owner'
                                ? 'text-[10px] border-primary/30 text-primary'
                                : 'text-[10px] border-violet-500/30 text-violet-300'
                            }
                          >
                            {kind === 'owner' ? 'Chủ / nội bộ' : 'Collaborator'}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-slate-400">{roleLabel(member.role)}</td>
                        <td className="px-5 py-3 text-slate-400 text-xs">
                          {formatDbTimestamp(member.created_at)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {kind === 'collaborator' && !isSelf ? (
                            <ConfirmDangerButton
                              title="Gỡ khỏi workspace?"
                              description={`${member.username} mất quyền truy cập workspace này.`}
                              confirmLabel="Gỡ"
                              onConfirm={() => onRemove(member)}
                              className="text-red-400"
                            >
                              <Trash2 className="w-4 h-4" />
                            </ConfirmDangerButton>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && members.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground text-sm">
                        Chưa có thành viên.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
