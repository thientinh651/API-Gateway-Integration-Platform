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
  const push = res.push ?? {};

  const step1: PipelineStep = {
    key: 'snapshot',
    label: 'Kéo dữ liệu Salesforce',
    status: opp > 0 ? 'ok' : 'skipped',
    summary:
      opp > 0
        ? `${opp} Opportunity đã kéo về`
        : 'Chưa có dữ liệu — kiểm tra kết nối Salesforce',
  };

  let filterStatus: PipelineStepStatus = 'ok';
  let filterSummary = 'Lọc Opportunity Closed Won đủ điều kiện';
  if (push.reason === 'no_items') {
    filterStatus = 'skipped';
    filterSummary = 'Không có deal đạt điều kiện — xem lịch sử đồng bộ';
  } else if (push.reason === 'need_both_connected') {
    filterStatus = 'skipped';
    filterSummary = 'Chỉ kéo Salesforce — chưa kết nối Zoho';
  } else {
    const created = push.created ?? 0;
    const skipped = push.skipped ?? 0;
    filterSummary = `Sau lọc: ${created} đẩy mới · ${skipped} bỏ qua`;
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
  let pushSummary = 'Tạo Project và công việc trên Zoho';
  if (push.reason === 'need_both_connected') {
    pushStatus = 'skipped';
    pushSummary = 'Bỏ qua — cần kết nối Zoho';
  } else if (push.reason === 'no_items') {
    pushStatus = 'skipped';
    pushSummary = 'Không có deal để đẩy';
  } else {
    const failed = countLogs(syncLogs, 'FAILED');
    const created = push.created ?? 0;
    if (failed > 0 && created === 0) {
      pushStatus = 'failed';
      pushSummary = `${failed} deal lỗi — xem lịch sử đồng bộ`;
    } else if (created > 0) {
      pushStatus = 'ok';
      pushSummary = `Tạo ${created} dự án · ${push.tasks_created ?? 0} công việc`;
    } else if ((push.skipped ?? 0) > 0) {
      pushStatus = 'skipped';
      pushSummary = `${push.skipped} deal đã đồng bộ trước đó`;
    } else {
      pushStatus = 'ok';
      pushSummary = 'Hoàn tất — không có deal mới';
    }
  }

  const step3: PipelineStep = {
    key: 'push',
    label: 'Tạo Project Zoho',
    status: pushStatus,
    summary: pushSummary,
  };

  const success = countLogs(syncLogs, 'SUCCESS');
  const skipped = countLogs(syncLogs, 'SKIPPED');
  const failed = countLogs(syncLogs, 'FAILED');

  const step4: PipelineStep = {
    key: 'log',
    label: 'Ghi lịch sử',
    status: syncLogs.length > 0 ? 'ok' : 'idle',
    summary:
      syncLogs.length > 0
        ? `${success} thành công · ${skipped} bỏ qua · ${failed} lỗi`
        : 'Chưa có lịch sử — chạy Đồng bộ ngay',
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
    label: 'Kéo dữ liệu Salesforce',
    status: !sfConnected ? 'idle' : oppCount > 0 ? 'ok' : 'skipped',
    summary: !sfConnected
      ? 'Kết nối Salesforce trước'
      : oppCount > 0
        ? `${oppCount} Opportunity đã kéo về`
        : 'Chưa có dữ liệu — bấm Đồng bộ ngay',
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
  let filterSummary = 'Chờ đồng bộ chạy';
  if (syncLogs.length > 0) {
    if (successPush > 0 || idempotentSkipped > 0 || failedPush > 0) {
      filterStatus = 'ok';
      filterSummary = `Đã lọc — ${routerSkipped + amountSkipped} deal bị loại trước khi đẩy`;
    } else if (routerSkipped > 0 || amountSkipped > 0) {
      filterStatus = 'skipped';
      filterSummary = `${routerSkipped + amountSkipped} deal bỏ qua (giai đoạn / giá trị)`;
    } else {
      filterStatus = 'skipped';
      filterSummary = 'Chưa có deal đạt Closed Won và đủ điều kiện';
    }
  }

  const step2: PipelineStep = {
    key: 'filter',
    label: 'Lọc Closed Won',
    status: filterStatus,
    summary: filterSummary,
  };

  let pushStatus: PipelineStepStatus = 'idle';
  let pushSummary = !zohoConnected ? 'Kết nối Zoho Projects' : 'Chờ Đồng bộ ngay';
  if (zohoConnected && syncLogs.length > 0) {
    if (failedPush > 0 && successPush === 0) {
      pushStatus = 'failed';
      pushSummary = `${failedPush} deal lỗi`;
    } else if (successPush > 0) {
      pushStatus = 'ok';
      pushSummary = `${successPush} deal đã tạo Project trên Zoho`;
    } else if (idempotentSkipped > 0) {
      pushStatus = 'skipped';
      pushSummary = `${idempotentSkipped} deal đã đồng bộ trước đó`;
    } else {
      pushStatus = 'skipped';
      pushSummary = 'Chưa đẩy deal mới';
    }
  }

  const step3: PipelineStep = {
    key: 'push',
    label: 'Tạo Project Zoho',
    status: pushStatus,
    summary: pushSummary,
  };

  const step4: PipelineStep = {
    key: 'log',
    label: 'Ghi lịch sử',
    status: syncLogs.length > 0 ? 'ok' : 'idle',
    summary:
      syncLogs.length > 0
        ? `${countLogs(syncLogs, 'SUCCESS')} thành công · ${countLogs(syncLogs, 'SKIPPED')} bỏ qua · ${countLogs(syncLogs, 'FAILED')} lỗi`
        : 'Chưa có bản ghi',
  };

  return [step1, step2, step3, step4];
}
