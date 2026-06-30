import type { AdminMe } from './api';

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** Mirror `admin_auth::rbac_allow` — path có hoặc không prefix `/api`. */
export function normalizeRole(role?: string): string {
  return (role ?? 'viewer').trim().toLowerCase();
}

function stripApiPrefix(path: string): string {
  const p = path.split('?')[0] ?? path;
  if (p.startsWith('/api/')) return p.slice(4);
  if (p === '/api') return '/';
  return p;
}

export function rbacAllow(method: HttpMethod, path: string, role?: string): boolean {
  const r = normalizeRole(role);
  const p = stripApiPrefix(path);
  const m = method.toUpperCase() as HttpMethod;
  const get = m === 'GET' || m === 'HEAD';
  const write = m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';

  if (r === 'admin') return true;

  if (r === 'viewer') {
    if (write) return false;
    if (
      p.startsWith('/client-keys') ||
      p.startsWith('/users') ||
      p.startsWith('/settings') ||
      p.startsWith('/crypto/') ||
      p.startsWith('/transaction-logs') ||
      p.startsWith('/audit-logs') ||
      p.startsWith('/proxy-queue') ||
      p.startsWith('/integrations') ||
      p === '/reload-config'
    ) {
      return false;
    }
    return get && (p === '/routes' || p.startsWith('/routes/') || p === '/dashboard/stats' || p === '/middleware/status' || p === '/me' || p === '/ping');
  }

  // operator — không users/settings/integrations
  if (
    p.startsWith('/users') ||
    p.startsWith('/settings') ||
    p.startsWith('/integrations') ||
    p === '/reload-config'
  ) {
    return false;
  }
  if (p.startsWith('/audit-logs') || p.startsWith('/transaction-logs')) {
    return get;
  }
  if (p.startsWith('/client-keys') || p.startsWith('/crypto/')) {
    if (p === '/crypto/public-key' && get) return true;
    if (p === '/client-keys' && get) return true;
    if (p === '/client-keys' && m === 'POST') return true;
    if (p === '/client-keys/bulk-status' && m === 'POST') return true;
    if (p === '/client-keys/traffic-summary' && m === 'GET') return true;
    if (p === '/client-keys/encrypted' && m === 'POST') return true;
    if (p.startsWith('/client-keys/') && m === 'DELETE') return true;
    if (p.startsWith('/client-keys/') && m === 'PATCH') return true;
    if (p.startsWith('/client-keys/') && m === 'GET' && p !== '/client-keys') return true;
    if (p.startsWith('/client-keys/') && p.endsWith('/routes') && (m === 'PUT' || m === 'GET')) return true;
    if (p.startsWith('/client-keys/') && p.endsWith('/rotate') && m === 'POST') return true;
    if (p.startsWith('/client-keys/') && p.endsWith('/traffic') && m === 'GET') return true;
    if (p.startsWith('/client-keys/') && p.endsWith('/revoke-tokens') && m === 'POST') return true;
    if (p === '/oauth/tokens' && m === 'GET') return true;
    if (p === '/oauth/tokens/revoke' && m === 'POST') return true;
    if (p === '/oauth/apps' && m === 'GET') return true;
    if (p === '/routes/acl-summary' && m === 'GET') return true;
    if (p.startsWith('/routes/') && p.endsWith('/clients') && m === 'GET') return true;
    return false;
  }
  if (get) return true;
  if (p.startsWith('/proxy-queue')) {
    return m === 'POST' || m === 'DELETE';
  }
  if (p === '/routes' && m === 'POST') return false;
  if (p.startsWith('/routes/') && m === 'DELETE') return false;
  return write;
}

export function canAccessClientKeys(user: AdminMe | null): boolean {
  const r = normalizeRole(user?.role);
  return r === 'admin' || r === 'operator';
}

export function canCreateRoute(user: AdminMe | null): boolean {
  return rbacAllow('POST', '/api/routes', user?.role);
}

export function canUpdateRoute(user: AdminMe | null): boolean {
  return rbacAllow('PUT', '/api/routes/1', user?.role);
}

export function canDeleteRoute(user: AdminMe | null): boolean {
  return rbacAllow('DELETE', '/api/routes/1', user?.role);
}

export function canWriteRoutes(user: AdminMe | null): boolean {
  return canCreateRoute(user);
}

export function canWriteClientKeys(user: AdminMe | null): boolean {
  return canAccessClientKeys(user) && rbacAllow('POST', '/api/client-keys', user?.role);
}

export function canDeleteClientKeys(user: AdminMe | null): boolean {
  return canAccessClientKeys(user) && rbacAllow('DELETE', '/api/client-keys/1', user?.role);
}

export function canManageUsers(user: AdminMe | null): boolean {
  return rbacAllow('POST', '/api/users', user?.role);
}

export function canEditSettings(user: AdminMe | null): boolean {
  return rbacAllow('PUT', '/api/settings', user?.role);
}

export function canMutateProxyQueue(user: AdminMe | null): boolean {
  return rbacAllow('POST', '/api/proxy-queue/1/retry', user?.role);
}

export function canManageIntegrations(user: AdminMe | null): boolean {
  return normalizeRole(user?.role) === 'admin';
}

export function canViewLogs(user: AdminMe | null): boolean {
  return rbacAllow('GET', '/api/transaction-logs', user?.role);
}

export function canViewAudit(user: AdminMe | null): boolean {
  return rbacAllow('GET', '/api/audit-logs', user?.role);
}

export function canManageOAuthApps(user: AdminMe | null): boolean {
  return normalizeRole(user?.role) === 'admin';
}

export function canViewOAuthTokens(user: AdminMe | null): boolean {
  const r = normalizeRole(user?.role);
  return r === 'admin' || r === 'operator';
}

export function canRevokeClientTokens(user: AdminMe | null): boolean {
  return canWriteClientKeys(user) && rbacAllow('POST', '/api/client-keys/1/revoke-tokens', user?.role);
}

export function isViewer(user: AdminMe | null): boolean {
  return normalizeRole(user?.role) === 'viewer';
}

export function isAdmin(user: AdminMe | null): boolean {
  return normalizeRole(user?.role) === 'admin';
}

const NAV_PAGE_GET_API: Record<string, string> = {
  '/routes': '/api/routes',
  '/auth': '/api/client-keys',
  '/proxy-queue': '/api/proxy-queue',
  '/integrations': '/api/integrations',
  '/users': '/api/users',
  '/logs': '/api/transaction-logs',
  '/settings': '/api/settings',
};

export function canAccessNavPath(path: string, user: AdminMe | null): boolean {
  if (path === '/' || path === '/api-docs' || path === '/register') return true;
  if (path === '/profile') return user != null;
  if (path === '/proxy-try') {
    return user != null && canAccessClientKeys(user);
  }
  if (!user) return false;

  const api = NAV_PAGE_GET_API[path];
  if (!api) return false;
  if (path === '/users') return canManageUsers(user);
  if (path === '/integrations') return canManageIntegrations(user);
  if (path === '/auth') return canAccessClientKeys(user);
  if (path === '/logs') return canViewLogs(user);
  if (path === '/proxy-queue') return rbacAllow('GET', '/api/proxy-queue', user.role);
  return rbacAllow('GET', api, user.role);
}

/** Nhãn UI — khớp thuật ngữ LVTN (mục 2.3.1). */
export function roleLabel(role?: string): string {
  const r = normalizeRole(role);
  if (r === 'admin') return 'Admin';
  if (r === 'operator') return 'Operator';
  return 'Viewer';
}

export function roleBadgeClass(role?: string): string {
  const r = normalizeRole(role);
  if (r === 'admin') return 'bg-red-500/15 text-red-300 border-red-500/35';
  if (r === 'operator') return 'bg-blue-500/15 text-blue-300 border-blue-500/35';
  return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35';
}

export function roleDescription(role?: string): string {
  const r = normalizeRole(role);
  if (r === 'admin') return 'Toàn quyền trong workspace của bạn';
  if (r === 'operator') return 'Vận hành route/key — chỉ tài nguyên do bạn tạo (key)';
  return 'Chỉ xem route — không API key, log, queue, tích hợp';
}
