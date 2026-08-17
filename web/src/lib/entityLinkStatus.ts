import type { EntityLinkRow } from './api';

/** Trạng thái tổng — field trên entity_links (không poll Zoho live). */
export type EntityLinkOverallKind = 'awaiting_completion' | 'sf_updated' | 'invoiced';

export type ChecklistState = 'done' | 'waiting' | 'pending';

export type ChecklistItem = {
  key: string;
  label: string;
  state: ChecklistState;
  stateLabel: string;
};

export type EntityLinkStatusView = {
  title: string;
  overall: EntityLinkOverallKind;
  overallLabel: string;
  overallTone: 'amber' | 'emerald' | 'sky';
  overallHint: string | null;
  hasInvoice: boolean;
  invoiceId: string | null;
  completionSynced: boolean;
  hasProject: boolean;
  checklist: ChecklistItem[];
};

export type EntityLinkSummary = {
  total: number;
  awaiting: number;
  sfUpdated: number;
  invoiced: number;
};

export function entityLinkTitle(row: EntityLinkRow): string {
  const name = row.target_display_name?.trim();
  if (name) return name;
  return row.source_id || row.target_id || 'Opportunity';
}

function checklistItem(
  key: string,
  label: string,
  state: ChecklistState,
): ChecklistItem {
  if (key === 'sync') {
    return {
      key,
      label,
      state,
      stateLabel: state === 'done' ? 'Đã hoàn tất' : 'Chưa thực hiện',
    };
  }
  if (key === 'project_done') {
    return {
      key,
      label,
      state,
      stateLabel:
        state === 'done' ? 'Đã hoàn thành' : state === 'waiting' ? 'Đang chờ' : 'Chưa thực hiện',
    };
  }
  if (key === 'sf_update') {
    return {
      key,
      label,
      state,
      stateLabel: state === 'done' ? 'Đã cập nhật Salesforce' : 'Chưa thực hiện',
    };
  }
  if (key === 'invoice') {
    return {
      key,
      label,
      state,
      stateLabel: state === 'done' ? 'Đã tạo' : 'Chưa tạo',
    };
  }
  return {
    key,
    label,
    state,
    stateLabel:
      state === 'done' ? 'Thành công' : state === 'waiting' ? 'Đang chờ' : 'Chưa thực hiện',
  };
}

export function deriveEntityLinkStatus(row: EntityLinkRow): EntityLinkStatusView {
  const completionSynced = Boolean(row.completion_synced_at);
  const invoiceId = row.invoice_external_id?.trim() || null;
  const hasInvoice = Boolean(invoiceId);
  const hasProject = Boolean(row.target_id?.trim());
  const synced = Boolean(row.last_synced_at) && hasProject;

  let overall: EntityLinkOverallKind;
  let overallLabel: string;
  let overallTone: 'amber' | 'emerald' | 'sky';
  let overallHint: string | null;

  if (hasInvoice && completionSynced) {
    overall = 'invoiced';
    overallLabel = 'Đã hoàn thành';
    overallTone = 'sky';
    overallHint = 'Đã cập nhật Salesforce và đã tạo hóa đơn.';
  } else if (completionSynced) {
    overall = 'sf_updated';
    overallLabel = 'Đã hoàn thành';
    overallTone = 'emerald';
    overallHint = 'Đã cập nhật trạng thái hoàn thành trên Salesforce.';
  } else {
    overall = 'awaiting_completion';
    overallLabel = 'Đang chờ hoàn thành';
    overallTone = 'amber';
    overallHint = 'Project Zoho chưa được xác nhận hoàn tất.';
  }

  const checklist: ChecklistItem[] = [
    checklistItem('sync', 'Đồng bộ sang Zoho', synced ? 'done' : 'pending'),
    checklistItem(
      'project_done',
      'Hoàn thành Project',
      completionSynced ? 'done' : synced ? 'waiting' : 'pending',
    ),
    checklistItem(
      'sf_update',
      'Cập nhật Salesforce',
      completionSynced ? 'done' : 'pending',
    ),
    checklistItem('invoice', 'Hóa đơn', hasInvoice ? 'done' : 'pending'),
  ];

  return {
    title: entityLinkTitle(row),
    overall,
    overallLabel,
    overallTone,
    overallHint,
    hasInvoice,
    invoiceId,
    completionSynced,
    hasProject,
    checklist,
  };
}

export function summarizeEntityLinks(links: EntityLinkRow[]): EntityLinkSummary {
  let awaiting = 0;
  let sfUpdated = 0;
  let invoiced = 0;
  for (const row of links) {
    const s = deriveEntityLinkStatus(row);
    if (!s.completionSynced) {
      awaiting += 1;
    } else {
      sfUpdated += 1;
      if (s.hasInvoice) invoiced += 1;
    }
  }
  return { total: links.length, awaiting, sfUpdated, invoiced };
}
