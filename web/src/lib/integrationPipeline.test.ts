import { describe, expect, it } from 'vitest';
import {
  buildPipelineFromSyncNow,
  buildPipelineFromState,
  resolvePipelineSteps,
} from './integrationPipeline';
import type { SyncLogRow, SyncNowResult } from './api';

describe('integrationPipeline', () => {
  it('buildPipelineFromSyncNow marks push ok when created', () => {
    const res: SyncNowResult = {
      status: 'ok',
      salesforce: { provider: 'salesforce', opportunity: 5, account: 2 },
      push: { created: 2, skipped: 1, tasks_created: 4 },
    };
    const steps = buildPipelineFromSyncNow(res, []);
    expect(steps[0].status).toBe('ok');
    expect(steps[2].status).toBe('ok');
    expect(steps[2].summary).toContain('2');
  });

  it('buildPipelineFromSyncNow marks filter skipped when no_items', () => {
    const res: SyncNowResult = {
      status: 'ok',
      salesforce: { provider: 'salesforce', opportunity: 3, account: 1 },
      push: { reason: 'no_items', created: 0, skipped: 0 },
    };
    const steps = buildPipelineFromSyncNow(res, []);
    expect(steps[1].status).toBe('skipped');
    expect(steps[2].status).toBe('skipped');
  });

  it('resolvePipelineSteps prefers server pipeline', () => {
    const server = {
      sf_connected: true,
      zoho_connected: true,
      both_connected: true,
      steps: [
        { key: 'snapshot' as const, label: 'Snapshot SF', status: 'ok' as const, summary: 'from server' },
        { key: 'filter' as const, label: 'Lọc', status: 'ok' as const, summary: 'x' },
        { key: 'push' as const, label: 'Push', status: 'ok' as const, summary: 'y' },
        { key: 'log' as const, label: 'Log', status: 'idle' as const, summary: 'z' },
      ],
    };
    const steps = resolvePipelineSteps(server, [], [], true, true);
    expect(steps[0].summary).toBe('from server');
  });

  it('buildPipelineFromState idle when not connected', () => {
    const steps = buildPipelineFromState([], [], false, false);
    expect(steps[0].status).toBe('idle');
    expect(steps[3].status).toBe('idle');
  });

  it('buildPipelineFromState reads SUCCESS logs', () => {
    const logs: SyncLogRow[] = [
      {
        id: 1,
        tenant_id: 1,
        status: 'SUCCESS',
        message: 'Middleware: "006" → Zoho "Deal A"',
        error_detail: null,
        event_type: 'entity_pushed',
        flow_type: 'sales_to_delivery',
        source_provider: 'salesforce',
        target_provider: 'zoho_projects',
        correlation_id: 'abc-123',
        metadata_json: null,
        created_at: '2026-01-01',
      },
    ];
    const steps = buildPipelineFromState(
      [{ provider: 'salesforce', entity_type: 'opportunity', record_count: 3, fetched_at: 'x' }],
      logs,
      true,
      true,
    );
    expect(steps[2].status).toBe('ok');
  });
});
