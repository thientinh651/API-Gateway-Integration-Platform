/** Dịch event_type / thông điệp kỹ thuật sang ngôn ngữ nghiệp vụ trên UI. */

const EVENT_LABELS: Record<string, string> = {
  pipeline_started: 'Bắt đầu đồng bộ',
  pipeline_completed: 'Đồng bộ hoàn tất',
  entity_pushed: 'Đã tạo / cập nhật dữ liệu',
  entity_skipped: 'Đã bỏ qua',
  entity_push_failed: 'Không thể đồng bộ',
  entity_link_stale: 'Đã dọn liên kết cũ',
  deal_filtered: 'Đã lọc deal',
};

export function friendlySyncEventType(eventType: string | null | undefined): string | null {
  if (!eventType) return null;
  return EVENT_LABELS[eventType] ?? null;
}

export function friendlySyncStatus(status: string): string {
  switch (status) {
    case 'SUCCESS':
      return 'Thành công';
    case 'FAILED':
      return 'Lỗi';
    case 'SKIPPED':
      return 'Bỏ qua';
    case 'RETRY':
      return 'Thử lại';
    default:
      return status;
  }
}

/** Làm mềm một số cụm kỹ thuật thường gặp trong message backend. */
export function softenSyncMessage(message: string): string {
  return message
    .replace(/Pipeline started:\s*sales_to_delivery/gi, 'Bắt đầu đồng bộ Salesforce sang Zoho')
    .replace(
      /Pipeline completed:\s*sales_to_delivery\s*\+\s*delivery_to_sales/gi,
      'Đồng bộ hoàn tất giữa Salesforce và Zoho',
    )
    .replace(/Pipeline completed/gi, 'Đồng bộ hoàn tất')
    .replace(/Pipeline started/gi, 'Bắt đầu đồng bộ')
    .replace(/need_both_connected/gi, 'cần kết nối cả Salesforce và Zoho')
    .replace(/entity link/gi, 'liên kết')
    .replace(/Entity link/gi, 'Liên kết')
    .replace(/SKIPPED summary:\s*/gi, '')
    .replace(/Middleware:\s*/gi, '')
    .replace(/correlation_id/gi, 'mã lần đồng bộ')
    .replace(/gateway loopback/gi, 'qua Gateway')
    .replace(/\bSF\b/g, 'Salesforce')
    .replace(/\bOpp\b/g, 'Opportunity');
}
