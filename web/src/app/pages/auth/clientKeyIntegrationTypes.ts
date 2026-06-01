/** Nhãn `integration_type` lưu DB — phân loại client key (audit), không thay OAuth Tích hợp. */
export const CLIENT_KEY_INTEGRATION_TYPES = [
  { value: 'app', label: 'Ứng dụng / phần mềm (mobile, web, script)' },
  { value: 'partner', label: 'Đối tác B2B' },
  { value: 'salesforce', label: 'Client data-plane Salesforce' },
  { value: 'zoho', label: 'Client data-plane Zoho Projects' },
  { value: 'test', label: 'Thử nghiệm / dev' },
] as const;

export type ClientKeyIntegrationType = (typeof CLIENT_KEY_INTEGRATION_TYPES)[number]['value'];

export const CLIENT_KEY_TYPE_HINT =
  'Nhãn phân loại key (audit, bảng dưới). OAuth Salesforce/Zoho cấu hình tại trang Tích hợp.';

export function integrationTypeLabel(value: string | undefined): string {
  const found = CLIENT_KEY_INTEGRATION_TYPES.find((t) => t.value === value);
  return found?.label ?? value ?? 'Ứng dụng';
}
