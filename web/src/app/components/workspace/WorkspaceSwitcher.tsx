import { useState } from 'react';
import { Building2, Check, ChevronDown, Home, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { switchWorkspace } from '../../../lib/api';
import { canSwitchWorkspace, currentWorkspaceName } from '../../../lib/deployment';
import { roleLabel } from '../../../lib/rbac';
import { toastApiError } from '../../../lib/apiClientError';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export function WorkspaceSwitcher() {
  const { user, refresh } = useAdminAuth();
  const [switching, setSwitching] = useState<number | null>(null);

  if (!user || !canSwitchWorkspace(user)) return null;

  const activeId = user.tenant_id ?? user.home_tenant_id;
  const activeName = currentWorkspaceName(user) ?? `Workspace #${activeId}`;
  const workspaces = user.workspaces ?? [];

  const onSwitch = async (tenantId: number) => {
    if (tenantId === activeId || switching != null) return;
    setSwitching(tenantId);
    try {
      await switchWorkspace(tenantId);
      await refresh();
      toast.success('Đã chuyển workspace — tải lại dữ liệu.');
      window.location.assign('/');
    } catch (e) {
      toastApiError(e);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 max-w-[11rem] sm:max-w-[14rem] border-border/80 bg-card/60 text-xs font-medium gap-1.5 px-2.5"
          disabled={switching != null}
        >
          {switching != null ? (
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          ) : (
            <Building2 className="w-3.5 h-3.5 shrink-0 text-primary" />
          )}
          <span className="truncate">{activeName}</span>
          <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 bg-card border-border">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Workspace
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((ws) => {
          const selected = ws.tenant_id === activeId;
          return (
            <DropdownMenuItem
              key={ws.tenant_id}
              className="flex items-start gap-2 cursor-pointer"
              onClick={() => void onSwitch(ws.tenant_id)}
              disabled={selected || switching != null}
            >
              <span className="mt-0.5 shrink-0">
                {selected ? (
                  <Check className="w-3.5 h-3.5 text-primary" />
                ) : ws.is_home ? (
                  <Home className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-white truncate">{ws.name}</span>
                <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                    {roleLabel(ws.role)}
                  </Badge>
                  {ws.is_home ? (
                    <span className="text-[10px] text-muted-foreground">Workspace</span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Được mời</span>
                  )}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
