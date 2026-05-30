import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forceLogoutOnSessionExpired,
  isSessionExpiredRedirect,
  registerSessionExpiryHandler,
  resetSessionExpiryForTests,
  setSessionActive,
  shouldForceLogout,
} from './sessionExpiry';

describe('sessionExpiry', () => {
  beforeEach(() => {
    resetSessionExpiryForTests();
  });

  afterEach(() => {
    resetSessionExpiryForTests();
    vi.unstubAllGlobals();
  });

  it('shouldForceLogout only when session active and not login/logout', () => {
    setSessionActive(true);
    expect(shouldForceLogout('/api/routes')).toBe(true);
    expect(shouldForceLogout('/api/login')).toBe(false);
    expect(shouldForceLogout('/api/logout')).toBe(false);
    expect(shouldForceLogout('/health')).toBe(false);

    setSessionActive(false);
    expect(shouldForceLogout('/api/routes')).toBe(false);
  });

  it('handles absolute API URLs', () => {
    setSessionActive(true);
    expect(shouldForceLogout('http://localhost:3000/api/me')).toBe(true);
  });

  it('forceLogout clears session and redirects once', () => {
    const replace = vi.fn();
    vi.stubGlobal('window', { location: { replace } });

    const handler = vi.fn();
    registerSessionExpiryHandler(handler);
    setSessionActive(true);

    forceLogoutOnSessionExpired();
    expect(handler).toHaveBeenCalledOnce();
    expect(isSessionExpiredRedirect()).toBe(true);
    expect(replace).toHaveBeenCalledWith('/login?expired=1');
    expect(shouldForceLogout('/api/routes')).toBe(false);

    forceLogoutOnSessionExpired();
    expect(replace).toHaveBeenCalledOnce();
  });
});
