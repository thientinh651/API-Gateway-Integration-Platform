import { describe, expect, it } from 'vitest';
import { resolveApiErrorTarget } from './apiErrorTarget';

describe('resolveApiErrorTarget', () => {
  it('maps salesforce API to Salesforce section', () => {
    const t = resolveApiErrorTarget('/api/integrations/salesforce/test');
    expect(t?.route).toBe('/integrations');
    expect(t?.sectionId).toBe('section-salesforce');
  });

  it('maps client-keys to Client Registry', () => {
    const t = resolveApiErrorTarget('/api/client-keys');
    expect(t?.sectionId).toBe('section-client-registry');
  });
});
