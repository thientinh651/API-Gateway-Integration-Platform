import { describe, expect, it } from 'vitest';
import { sanitizeReturnTo } from './safeReturnTo';

describe('sanitizeReturnTo', () => {
  it('allows relative authorize path', () => {
    const v =
      '/oauth/authorize?response_type=code&client_id=avaso_pk_x&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Foauth%2Fcallback';
    expect(sanitizeReturnTo(v)).toBe(v);
  });

  it('allows dashboard paths', () => {
    expect(sanitizeReturnTo('/auth?tab=apps')).toBe('/auth?tab=apps');
  });

  it('rejects open redirects', () => {
    expect(sanitizeReturnTo('https://evil.example/phish')).toBeNull();
    expect(sanitizeReturnTo('//evil.example')).toBeNull();
    expect(sanitizeReturnTo('oauth/authorize')).toBeNull();
  });

  it('rejects login loops', () => {
    expect(sanitizeReturnTo('/login')).toBeNull();
    expect(sanitizeReturnTo('/login?x=1')).toBeNull();
  });
});
