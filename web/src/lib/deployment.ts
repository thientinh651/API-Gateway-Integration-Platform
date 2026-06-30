import type { AdminMe, DeploymentMode } from './api';

export function isSaasMode(deploymentMode?: DeploymentMode | null): boolean {
  return deploymentMode === 'saas';
}

export function isOnPremMode(deploymentMode?: DeploymentMode | null): boolean {
  return deploymentMode !== 'saas';
}

export function deploymentModeLabel(mode?: DeploymentMode | null): string {
  return mode === 'saas' ? 'Multi-tenant' : 'Single organization';
}

export function deploymentModeBadgeClass(mode?: DeploymentMode | null): string {
  return mode === 'saas'
    ? 'bg-violet-500/15 text-violet-300 border-violet-500/35'
    : 'bg-slate-500/15 text-slate-300 border-slate-500/35';
}

export function resolveDeploymentMode(
  user: AdminMe | null,
  publicMode?: DeploymentMode | null,
): DeploymentMode {
  return user?.deployment_mode ?? publicMode ?? 'on_prem';
}

export function currentWorkspaceName(user: AdminMe | null): string | null {
  if (!user?.workspaces?.length || user.tenant_id == null) return null;
  return user.workspaces.find((w) => w.tenant_id === user.tenant_id)?.name ?? null;
}

export function canSwitchWorkspace(user: AdminMe | null): boolean {
  return isSaasMode(user?.deployment_mode) && (user?.workspaces?.length ?? 0) > 0;
}
