import { describe, expect, it } from 'vitest';
import { inferMiddlewareStage, isUpstreamProviderBody, reasonLabel } from './middlewareLabels';

describe('reasonLabel', () => {
  it('maps known middleware reasons', () => {
    expect(reasonLabel('rate_limit_exceeded')).toContain('rate limit');
    expect(reasonLabel('client_key_disabled')).toContain('tắt');
  });

  it('falls back to raw code', () => {
    expect(reasonLabel('custom_reason')).toBe('custom_reason');
  });
});

describe('isUpstreamProviderBody', () => {
  it('detects OpenWeather style body', () => {
    expect(isUpstreamProviderBody({ cod: 401, message: 'Invalid API key' })).toBe(true);
  });

  it('ignores gateway error envelope', () => {
    expect(isUpstreamProviderBody({ error: 'invalid_token', message: 'bad' })).toBe(false);
  });
});

describe('inferMiddlewareStage', () => {
  it('classifies auth failures', () => {
    expect(inferMiddlewareStage(401, 'invalid_token')).toBe('authentication');
  });

  it('classifies upstream 401 passthrough', () => {
    expect(
      inferMiddlewareStage(401, undefined, 'denied', { cod: 401, message: 'Invalid API key' }),
    ).toBe('upstream');
  });

  it('classifies ACL denials', () => {
    expect(inferMiddlewareStage(403, 'route_forbidden')).toBe('authorization');
  });

  it('classifies rate limit', () => {
    expect(inferMiddlewareStage(429, 'rate_limit_exceeded')).toBe('rate_limit');
  });
});
