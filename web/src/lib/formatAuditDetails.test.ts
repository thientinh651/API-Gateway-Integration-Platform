import { describe, expect, it } from 'vitest';
import { formatAuditDetails } from './formatAuditDetails';

describe('formatAuditDetails', () => {
  it('hides legacy UUID dump — summary only', () => {
    const ids = [
      'd27a18c3-950c-4669-87cf-70d88393371a',
      'c2be1871-a082-4f9f-a39e-b0c0f74e13d0',
      '1da6c790-ef9c-4f11-9abc-1234567890ab',
    ].join(',');
    expect(formatAuditDetails(ids, 'proxy_queue_bulk_discard')).toBe(
      'Đã xóa 3 bản ghi Proxy Queue (DLQ)',
    );
  });

  it('flattens multiline method/path into one preview', () => {
    const raw =
      'Đã xóa 2/2 bản ghi Proxy Queue (DLQ)\nGET /v1/api/get · upstream_status:503\nPOST /orders · upstream_timeout';
    const f = formatAuditDetails(raw, 'proxy_queue_bulk_discard');
    expect(f).toContain('Đã xóa 2/2');
    expect(f).toContain('GET /v1/api/get · upstream_status:503');
    expect(f).toContain('POST /orders · upstream_timeout');
  });

  it('keeps short key=value as-is', () => {
    const f = formatAuditDetails('app="Test" client_id=avaso_pk_x id=3', 'update_oauth_app');
    expect(f).toContain('app="Test"');
    expect(f).toContain('client_id=');
  });
});
