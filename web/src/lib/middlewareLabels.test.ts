import { describe, expect, it } from 'vitest';
import { inferMiddlewareStage, reasonLabel } from './middlewareLabels';

describe('reasonLabel', () => {
  it('maps known middleware reasons', () => {
    expect(reasonLabel('rate_limit_exceeded')).toContain('rate limit');
    expect(reasonLabel('client_key_disabled')).toContain('tắt');
  });

  it('falls back to raw code', () => {
    expect(reasonLabel('custom_reason')).toBe('custom_reason');
  });
});

describe('inferMiddlewareStage', () => {
  it('classifies auth failures', () => {
    expect(inferMiddlewareStage(401, 'invalid_signature')).toBe('authentication');
  });

  it('classifies ACL denials', () => {
    expect(inferMiddlewareStage(403, 'route_forbidden')).toBe('authorization');
  });

  it('classifies rate limit', () => {
    expect(inferMiddlewareStage(429, 'rate_limit_exceeded')).toBe('rate_limit');
  });
});
