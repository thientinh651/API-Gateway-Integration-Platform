import { describe, expect, it } from 'vitest';
import { ApiClientError, formatApiErrorToast, isMissingBackendApi } from './apiClientError';

describe('apiClientError', () => {
  it('detects missing backend API 404', () => {
    const e = new ApiClientError(
      404,
      'not_found',
      'Admin API is mounted at /api/*; use a valid path and admin X-API-Key',
      undefined,
      '/api/integrations/transform/profile',
    );
    expect(isMissingBackendApi(e)).toBe(true);
    expect(formatApiErrorToast(e)).toContain('deploy');
  });
});
