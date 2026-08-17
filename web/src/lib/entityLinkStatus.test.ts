import { describe, expect, it } from 'vitest';
import type { EntityLinkRow } from './api';
import { deriveEntityLinkStatus, summarizeEntityLinks } from './entityLinkStatus';

function base(partial: Partial<EntityLinkRow> = {}): EntityLinkRow {
  return {
    flow_type: 'sales_to_delivery',
    source_provider: 'salesforce',
    source_entity_type: 'opportunity',
    source_id: '006ABC',
    target_provider: 'zoho_projects',
    target_entity_type: 'project',
    target_id: '268275000000174003',
    target_display_name: 'Làm web laptop',
    last_synced_at: '2026-08-03T16:20:58Z',
    completion_synced_at: null,
    invoice_external_id: null,
    invoice_created_at: null,
    ...partial,
  };
}

describe('deriveEntityLinkStatus', () => {
  it('marks awaiting when project linked but SF not updated', () => {
    const s = deriveEntityLinkStatus(base());
    expect(s.overall).toBe('awaiting_completion');
    expect(s.overallLabel).toBe('Đang chờ hoàn thành');
    expect(s.checklist.find((c) => c.key === 'project_done')?.state).toBe('waiting');
    expect(s.checklist.find((c) => c.key === 'sf_update')?.state).toBe('pending');
  });

  it('marks completed when completion_synced_at set', () => {
    const s = deriveEntityLinkStatus(
      base({ completion_synced_at: '2026-08-03T16:21:00Z' }),
    );
    expect(s.overall).toBe('sf_updated');
    expect(s.overallLabel).toBe('Đã hoàn thành');
    expect(s.checklist.every((c) => c.key === 'invoice' || c.state === 'done')).toBe(true);
  });

  it('marks invoiced when invoice id present after completion', () => {
    const s = deriveEntityLinkStatus(
      base({
        completion_synced_at: '2026-08-03T16:21:00Z',
        invoice_external_id: 'a0X123',
        invoice_created_at: '2026-08-03T16:22:00Z',
      }),
    );
    expect(s.overall).toBe('invoiced');
    expect(s.hasInvoice).toBe(true);
    expect(s.checklist.find((c) => c.key === 'invoice')?.stateLabel).toBe('Đã tạo');
    expect(s.checklist.find((c) => c.key === 'sf_update')?.stateLabel).toBe(
      'Đã cập nhật Salesforce',
    );
  });
});

describe('summarizeEntityLinks', () => {
  it('counts buckets', () => {
    const sum = summarizeEntityLinks([
      base({ source_id: '1' }),
      base({ source_id: '2', completion_synced_at: 't' }),
      base({
        source_id: '3',
        completion_synced_at: 't',
        invoice_external_id: 'inv',
      }),
    ]);
    expect(sum).toEqual({ total: 3, awaiting: 1, sfUpdated: 2, invoiced: 1 });
  });
});
