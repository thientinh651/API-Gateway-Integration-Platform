import { describe, expect, it } from 'vitest';
import {
  canAccessNavPath,
  canCreateRoute,
  canDeleteRoute,
  canEditSettings,
  canMutateProxyQueue,
  canUpdateRoute,
  canWriteClientKeys,
  rbacAllow,
} from './rbac';

describe('rbacAllow (sync backend admin_auth)', () => {
  it('admin full access', () => {
    expect(rbacAllow('DELETE', '/api/users/1', 'admin')).toBe(true);
    expect(rbacAllow('POST', '/api/routes', 'admin')).toBe(true);
  });

  it('viewer read only', () => {
    expect(rbacAllow('GET', '/api/routes', 'viewer')).toBe(true);
    expect(rbacAllow('POST', '/api/routes', 'viewer')).toBe(false);
  });

  it('operator can PUT routes not POST/DELETE', () => {
    expect(rbacAllow('PUT', '/api/routes/3', 'operator')).toBe(true);
    expect(rbacAllow('POST', '/api/routes', 'operator')).toBe(false);
    expect(rbacAllow('DELETE', '/api/routes/3', 'operator')).toBe(false);
  });

  it('operator blocked users and settings', () => {
    expect(rbacAllow('GET', '/api/users', 'operator')).toBe(false);
    expect(rbacAllow('PUT', '/api/settings', 'operator')).toBe(false);
  });

  it('operator can manage client keys', () => {
    expect(rbacAllow('POST', '/api/client-keys', 'operator')).toBe(true);
    expect(rbacAllow('DELETE', '/api/client-keys/1', 'operator')).toBe(true);
  });

  it('operator integrations read only', () => {
    expect(rbacAllow('GET', '/api/integrations', 'operator')).toBe(true);
    expect(rbacAllow('POST', '/api/integrations/salesforce/sync', 'operator')).toBe(false);
    expect(rbacAllow('GET', '/api/integrations/salesforce/test', 'operator')).toBe(false);
  });
});

describe('rbac helpers', () => {
  const operator = { username: 'op', role: 'operator' };
  const admin = { username: 'a', role: 'admin' };
  const viewer = { username: 'v', role: 'viewer' };

  it('route permissions', () => {
    expect(canCreateRoute(admin)).toBe(true);
    expect(canCreateRoute(operator)).toBe(false);
    expect(canUpdateRoute(operator)).toBe(true);
    expect(canDeleteRoute(operator)).toBe(false);
    expect(canUpdateRoute(viewer)).toBe(false);
  });

  it('settings and keys', () => {
    expect(canEditSettings(operator)).toBe(false);
    expect(canEditSettings(admin)).toBe(true);
    expect(canWriteClientKeys(operator)).toBe(true);
    expect(canWriteClientKeys(viewer)).toBe(false);
    expect(canMutateProxyQueue(viewer)).toBe(false);
    expect(canMutateProxyQueue(operator)).toBe(true);
  });
});

describe('canAccessNavPath', () => {
  const viewer = { username: 'v', role: 'viewer' };
  const operator = { username: 'op', role: 'operator' };
  const admin = { username: 'a', role: 'admin' };

  it('guest public pages only', () => {
    expect(canAccessNavPath('/', null)).toBe(true);
    expect(canAccessNavPath('/api-docs', null)).toBe(true);
    expect(canAccessNavPath('/routes', null)).toBe(false);
    expect(canAccessNavPath('/proxy-try', null)).toBe(false);
  });

  it('viewer no users', () => {
    expect(canAccessNavPath('/routes', viewer)).toBe(true);
    expect(canAccessNavPath('/users', viewer)).toBe(false);
    expect(canAccessNavPath('/settings', viewer)).toBe(true);
  });

  it('operator no users', () => {
    expect(canAccessNavPath('/users', operator)).toBe(false);
    expect(canAccessNavPath('/integrations', operator)).toBe(true);
  });

  it('admin all nav pages', () => {
    expect(canAccessNavPath('/users', admin)).toBe(true);
    expect(canAccessNavPath('/proxy-try', admin)).toBe(true);
  });
});
