import type {
  IntegrationPipelineStatus,
  IntegrationSnapshotSummary,
  SyncLogRow,
  SyncNowResult,
} from './api';

export type PipelineStepStatus = 'idle' | 'ok' | 'skipped' | 'failed';

export type PipelineStep = {
  key: 'snapshot' | 'filter' | 'push' | 'log';
  label: string;
  status: PipelineStepStatus;
  summary: string;
};

/**
 * Nguồn chính: Rust `GET /pipeline-status` và field `pipeline` trong `sync-now`.
 * Các hàm build* bên dưới chỉ fallback khi API không trả pipeline (lỗi mạng / binary cũ).
 */
export function resolvePipelineSteps(
  serverPipeline: IntegrationPipelineStatus | null,
  snapshots: IntegrationSnapshotSummary[],
  syncLogs: SyncLogRow[],
  sfConnected: boolean,
  zohoConnected: boolean,
): PipelineStep[] {
  if (serverPipeline?.steps?.length) {
    return serverPipeline.steps;
  }
  return buildPipelineFromState(snapshots, syncLogs, sfConnected, zohoConnected);
}

function countLogs(logs: SyncLogRow[], status: string) {
  return logs.filter((l) => l.status === status).length;
}

/** Mirror Rust `build_pipeline_from_run` — unit test / đối chiếu client-server. */
export function buildPipelineFromSyncNow(res: SyncNowResult, syncLogs: SyncLogRow[]): PipelineStep[] {
  const opp = res.salesforce?.opportunity ?? 0;
  const acc = res.salesforce?.account ?? 0;
  const push = res.push ?? {};

  const step1: PipelineStep = {
    key: 'snapshot',
    label: 'Snapshot SF',
    status: opp > 0 ? 'ok' : 'skipped',
    summary:
      opp > 0
        ? `${opp} Opportunity · ${acc} Account — pull qua gateway loopback`
        : 'Snapshot rỗng — kiểm tra kết nối Salesforce',
  };

  let filterStatus: PipelineStepStatus = 'ok';
  let filterSummary = 'Lọc Stage = Closed Won + Amount ≥ ngưỡng';
  if (push.reason === 'no_items') {
    filterStatus = 'skipped';
    filterSummary = 'Không có deal đạt điều kiện — xem Sync Log (SKIPPED)';
  } else if (push.reason === 'need_both_connected') {
    filterStatus = 'skipped';
    filterSummary = 'Chỉ pull SF — chưa kết nối Zoho để push';
  } else {
    const created = push.created ?? 0;
    const skipped = push.skipped ?? 0;
    filterSummary = `Sau lọc: ${created} đẩy mới · ${skipped} bỏ qua (đã link / không đạt)`;
    if (created === 0 && skipped === 0) {
      filterStatus = 'skipped';
    }
  }

  const step2: PipelineStep = {
    key: 'filter',
    label: 'Lọc Closed Won',
    status: filterStatus,
    summary: filterSummary,
  };

  let pushStatus: PipelineStepStatus = 'idle';
  let pushSummary = 'Tạo Project + Task trên Zoho Projects';
  if (push.reason === 'need_both_connected') {
    pushStatus = 'skipped';
    pushSummary = 'Bỏ qua — cần Zoho connected';
  } else if (push.reason === 'no_items') {
    pushStatus = 'skipped';
    pushSummary = 'Không có deal để đẩy';
  } else {
    const failed = countLogs(syncLogs, 'FAILED');
    const created = push.created ?? 0;
    if (failed > 0 && created === 0) {
      pushStatus = 'failed';
      pushSummary = `${failed} deal FAILED — xem Sync Log`;
    } else if (created > 0) {
      pushStatus = 'ok';
      pushSummary = `Tạo ${created} dự án · ${push.tasks_created ?? 0} task`;
    } else if ((push.skipped ?? 0) > 0) {
      pushStatus = 'skipped';
      pushSummary = `${push.skipped} deal đã đồng bộ trước đó (idempotent)`;
    } else {
      pushStatus = 'ok';
      pushSummary = 'Push hoàn tất — không có deal mới';
    }
  }

  const step3: PipelineStep = {
    key: 'push',
    label: 'Push Zoho',
    status: pushStatus,
    summary: pushSummary,
  };

  const success = countLogs(syncLogs, 'SUCCESS');
  const skipped = countLogs(syncLogs, 'SKIPPED');
  const failed = countLogs(syncLogs, 'FAILED');

  const step4: PipelineStep = {
    key: 'log',
    label: 'Sync Log',
    status: syncLogs.length > 0 ? 'ok' : 'idle',
    summary:
      syncLogs.length > 0
        ? `${success} OK · ${skipped} SKIPPED · ${failed} FAILED`
        : 'Chưa có log — chạy Sync Now',
  };

  return [step1, step2, step3, step4];
}

export function buildPipelineFromState(
  snapshots: IntegrationSnapshotSummary[],
  syncLogs: SyncLogRow[],
  sfConnected: boolean,
  zohoConnected: boolean,
): PipelineStep[] {
  const oppSnap = snapshots.find(
    (s) => s.provider === 'salesforce' && s.entity_type === 'opportunity',
  );
  const oppCount = oppSnap?.record_count ?? 0;

  const step1: PipelineStep = {
    key: 'snapshot',
    label: 'Snapshot SF',
    status: !sfConnected ? 'idle' : oppCount > 0 ? 'ok' : 'skipped',
    summary: !sfConnected
      ? 'Kết nối Salesforce trước'
      : oppCount > 0
        ? `${oppCount} Opportunity trong snapshot mới nhất`
        : 'Chưa có snapshot — bấm Sync Now',
  };

  const routerSkipped = syncLogs.filter(
    (l) => l.status === 'SKIPPED' && l.message.includes('Middleware router'),
  ).length;
  const amountSkipped = syncLogs.filter(
    (l) => l.status === 'SKIPPED' && l.message.includes('Amount'),
  ).length;
  const successPush = syncLogs.filter(
    (l) => l.status === 'SUCCESS' && l.message.includes('→ Zoho'),
  ).length;
  const idempotentSkipped = syncLogs.filter(
    (l) => l.status === 'SKIPPED' && l.message.includes('Đã đồng bộ'),
  ).length;
  const failedPush = syncLogs.filter((l) => l.status === 'FAILED').length;

  let filterStatus: PipelineStepStatus = 'idle';
  let filterSummary = 'Chờ pipeline chạy';
  if (syncLogs.length > 0) {
    if (successPush > 0 || idempotentSkipped > 0 || failedPush > 0) {
      filterStatus = 'ok';
      filterSummary = `Đã lọc — ${routerSkipped + amountSkipped} deal bị loại trước push`;
    } else if (routerSkipped > 0 || amountSkipped > 0) {
      filterStatus = 'skipped';
      filterSummary = `${routerSkipped + amountSkipped} deal SKIPPED (stage/amount)`;
    } else {
      filterStatus = 'skipped';
      filterSummary = 'Chưa có deal đạt Closed Won + ngưỡng';
    }
  }

  const step2: PipelineStep = {
    key: 'filter',
    label: 'Lọc Closed Won',
    status: filterStatus,
    summary: filterSummary,
  };

  let pushStatus: PipelineStepStatus = 'idle';
  let pushSummary = !zohoConnected ? 'Kết nối Zoho Projects' : 'Chờ Sync Now';
  if (zohoConnected && syncLogs.length > 0) {
    if (failedPush > 0 && successPush === 0) {
      pushStatus = 'failed';
      pushSummary = `${failedPush} deal FAILED`;
    } else if (successPush > 0) {
      pushStatus = 'ok';
      pushSummary = `${successPush} deal đã push lên Zoho`;
    } else if (idempotentSkipped > 0) {
      pushStatus = 'skipped';
      pushSummary = `${idempotentSkipped} deal đã có entity link`;
    } else {
      pushStatus = 'skipped';
      pushSummary = 'Chưa push deal mới';
    }
  }

  const step3: PipelineStep = {
    key: 'push',
    label: 'Push Zoho',
    status: pushStatus,
    summary: pushSummary,
  };

  const step4: PipelineStep = {
    key: 'log',
    label: 'Sync Log',
    status: syncLogs.length > 0 ? 'ok' : 'idle',
    summary:
      syncLogs.length > 0
        ? `${countLogs(syncLogs, 'SUCCESS')} OK · ${countLogs(syncLogs, 'SKIPPED')} SKIPPED · ${countLogs(syncLogs, 'FAILED')} FAILED`
        : 'Chưa có bản ghi',
  };

  return [step1, step2, step3, step4];
}
