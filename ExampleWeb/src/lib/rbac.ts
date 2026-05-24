import type { AdminMe } from './api';

export function normalizeRole(role?: string): string {
  return (role ?? 'viewer').trim().toLowerCase();
}

export function canWriteRoutes(user: AdminMe | null): boolean {
  return normalizeRole(user?.role) === 'admin';
}

export function canWriteClientKeys(user: AdminMe | null): boolean {
  const r = normalizeRole(user?.role);
  return r === 'admin' || r === 'operator';
}

export function canManageUsers(user: AdminMe | null): boolean {
  return normalizeRole(user?.role) === 'admin';
}

export function isViewer(user: AdminMe | null): boolean {
  return normalizeRole(user?.role) === 'viewer';
}
