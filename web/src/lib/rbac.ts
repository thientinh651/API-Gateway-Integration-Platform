import type { AdminMe } from './api';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

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

  if (r === 'admin') return true;
  if (r === 'viewer') return m === 'GET';

  // operator
  if (p.startsWith('/users')) return false;

  if (p.startsWith('/integrations')) {
    if (p === '/integrations' && m === 'GET') return true;
    if (
      (p === '/integrations/salesforce/test' || p === '/integrations/zoho/test') &&
      m === 'GET'
    ) {
      return false;
    }
    if (p.includes('/connect') || p.includes('/disconnect') || p.includes('/sync')) {
      return false;
    }
    return m === 'GET';
  }

  if (m === 'GET') return true;
  if (p.startsWith('/settings')) return false;
  if (p === '/reload-config') return false;
  if (p === '/routes' && m === 'POST') return false;
  if (p.startsWith('/routes/') && m === 'DELETE') return false;

  return true;
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

/** @deprecated Prefer canCreateRoute / canUpdateRoute / canDeleteRoute */
export function canWriteRoutes(user: AdminMe | null): boolean {
  return canCreateRoute(user);
}

export function canWriteClientKeys(user: AdminMe | null): boolean {
  return rbacAllow('POST', '/api/client-keys', user?.role);
}

export function canDeleteClientKeys(user: AdminMe | null): boolean {
  return rbacAllow('DELETE', '/api/client-keys/1', user?.role);
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

export function isViewer(user: AdminMe | null): boolean {
  return normalizeRole(user?.role) === 'viewer';
}

/** Admin API GET tương ứng trang dashboard — dùng lọc menu & guard route. */
const NAV_PAGE_GET_API: Record<string, string> = {
  '/routes': '/api/routes',
  '/auth': '/api/client-keys',
  '/proxy-queue': '/api/proxy-queue',
  '/integrations': '/api/integrations',
  '/users': '/api/users',
  '/logs': '/api/transaction-logs',
  '/audit': '/api/audit-logs',
  '/settings': '/api/settings',
};

/**
 * Trang có trong menu chỉ khi role đọc được API chính của trang (khớp backend).
 * Khách: Tổng quan + Tài liệu API. Trang cần đăng nhập: ẩn khi chưa login.
 */
export function canAccessNavPath(path: string, user: AdminMe | null): boolean {
  if (path === '/' || path === '/api-docs') return true;
  if (path === '/proxy-try') return user != null;
  if (!user) return false;

  const api = NAV_PAGE_GET_API[path];
  if (!api) return false;
  if (path === '/users') return canManageUsers(user);
  return rbacAllow('GET', api, user.role);
}

export function roleLabel(role?: string): string {
  const r = normalizeRole(role);
  if (r === 'admin') return 'Admin';
  if (r === 'operator') return 'Operator';
  return 'Viewer';
}
