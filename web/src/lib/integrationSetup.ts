export function describeOAuthRedirectError(code: string, detail?: string | null): string {
  if (detail?.trim()) return detail.trim();
  switch (code) {
    case 'token_exchange_failed':
      return 'Đổi authorization code → token thất bại.';
    case 'missing_code':
      return 'Không nhận được authorization code — thử Kết nối lại.';
    case 'invalid_state':
    case 'state_expired':
      return 'Phiên OAuth hết hạn — bấm Kết nối lại.';
    case 'not_configured':
      return 'Chưa có Client ID/Secret.';
    default:
      return `OAuth lỗi: ${code}`;
  }
}
