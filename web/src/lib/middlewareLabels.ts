/** Nhãn hiển thị cho middleware data plane — dùng chung Logs, ProxyTry, ApiDocs. */

export type MiddlewareStage =
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'routing'
  | 'upstream'
  | 'success';

export const MIDDLEWARE_STAGE_VI: Record<MiddlewareStage, string> = {
  authentication: 'Authentication',
  authorization: 'Authorization',
  rate_limit: 'Rate limiting',
  routing: 'Routing',
  upstream: 'Upstream',
  success: 'Forwarded',
};

export const TRANSACTION_REASON_VI: Record<string, string> = {
  missing_or_invalid_api_key: 'Sai hoặc thiếu API Key / HMAC',
  invalid_signature: 'Chữ ký HMAC không hợp lệ',
  replay_detected: 'Replay — chữ ký trùng trong cửa sổ thời gian',
  client_key_disabled: 'Client bị tắt trong registry',
  route_forbidden: 'Client không có quyền route này (ACL)',
  tenant_forbidden: 'Tenant key không khớp route',
  rate_limit_exceeded: 'Vượt rate limit',
  not_found: 'Không có route khớp path',
  forwarded: 'Đã chuyển tiếp upstream',
  forwarded_after_retry: 'Forward sau retry',
  queued_after_failure: 'Xếp hàng DLQ sau lỗi',
  integration_proxy: 'Integration proxy (SF/Zoho)',
  canonical_transform: 'Transform canonical schema',
  denied: 'Từ chối tại middleware',
};

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  return TRANSACTION_REASON_VI[reason] ?? reason;
}

export function inferMiddlewareStage(
  status: number,
  reason?: string | null,
  outcome?: string | null,
): MiddlewareStage {
  const r = (reason ?? '').toLowerCase();
  if (outcome === 'success' || r === 'forwarded' || r === 'integration_proxy') return 'success';
  if (
    r.includes('api_key') ||
    r.includes('signature') ||
    r.includes('replay') ||
    r === 'invalid_signature' ||
    status === 401
  ) {
    return 'authentication';
  }
  if (
    r.includes('forbidden') ||
    r.includes('disabled') ||
    r === 'route_forbidden' ||
    r === 'client_key_disabled' ||
    status === 403
  ) {
    return 'authorization';
  }
  if (r.includes('rate_limit') || status === 429) return 'rate_limit';
  if (r === 'not_found' || status === 404) return 'routing';
  if (status >= 500 || r.includes('upstream') || r.includes('queued')) return 'upstream';
  return 'routing';
}

export function parseGatewayErrorBody(bodyJson: unknown): {
  error?: string;
  message?: string;
} | null {
  if (!bodyJson || typeof bodyJson !== 'object') return null;
  const row = bodyJson as Record<string, unknown>;
  if (typeof row.error !== 'string') return null;
  return {
    error: row.error,
    message: typeof row.message === 'string' ? row.message : undefined,
  };
}

/** Lọc transaction log theo middleware reason */
export const MIDDLEWARE_REASON_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Mọi middleware reason' },
  ...Object.entries(TRANSACTION_REASON_VI).map(([value, label]) => ({ value, label })),
];
