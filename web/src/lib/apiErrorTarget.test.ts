import { describe, expect, it } from 'vitest';
import { resolveApiErrorTarget } from './apiErrorTarget';

describe('resolveApiErrorTarget', () => {
  it('maps transform API to Transform Engine section', () => {
    const t = resolveApiErrorTarget('/api/integrations/transform/profile');
    expect(t?.route).toBe('/integrations');
    expect(t?.sectionId).toBe('section-transform-engine');
  });

  it('maps client-keys to Client Registry', () => {
    const t = resolveApiErrorTarget('/api/client-keys');
    expect(t?.sectionId).toBe('section-client-registry');
  });
});
