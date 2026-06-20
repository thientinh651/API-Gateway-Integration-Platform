export const DATA_PLANE_PREFIX = '/v1/api';

export type ProxyTryResult = {
  ok: boolean;
  status: number;
  statusText: string;
  elapsedMs: number;
  bodyText: string;
  bodyJson: unknown | null;
  sentApiKey: boolean;
  requestUrl: string;
  method: string;
};

function normalizePath(path: string): string {
  const p = path.trim();
  if (!p) return '/v1/api/get';
  return p.startsWith('/') ? p : `/${p}`;
}

function tryParseJson(text: string): unknown | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Gọi data-plane qua cùng origin (Nginx → gateway). Không dùng cookie admin. */
export async function tryDataPlaneRequest(options: {
  path: string;
  method: string;
  apiKey?: string;
  secretKey?: string;
}): Promise<ProxyTryResult> {
  const method = (options.method || 'GET').toUpperCase();
  const requestUrl = normalizePath(options.path);
  const key = options.apiKey?.trim() ?? '';
  const secret = options.secretKey?.trim() ?? '';
  const headers: HeadersInit = {};
  if (key) {
    headers['X-API-Key'] = key;
    if (secret.startsWith('avaso_sk_')) {
      const { buildSigningPayload, hmacSha256Hex, unixTimestampSecs } = await import('./hmacSign');
      const ts = unixTimestampSecs();
      const payload = buildSigningPayload(key, ts, method, requestUrl, '');
      headers['X-Timestamp'] = ts;
      headers['X-Signature'] = await hmacSha256Hex(secret, payload);
    }
  }

  const started = performance.now();
  const r = await fetch(requestUrl, {
    method,
    headers,
    credentials: 'omit',
  });
  const elapsedMs = Math.round(performance.now() - started);
  const bodyText = await r.text().catch(() => '');

  return {
    ok: r.ok,
    status: r.status,
    statusText: r.statusText,
    elapsedMs,
    bodyText,
    bodyJson: tryParseJson(bodyText),
    sentApiKey: Boolean(key),
    requestUrl,
    method,
  };
}

/** Path bắt đầu bằng prefix nhưng thiếu `/` sau `api` (vd `/v1/api123`). */
export function isDataPlaneTypoPath(path: string): boolean {
  const p = normalizePath(path);
  return p.startsWith(DATA_PLANE_PREFIX) && p !== DATA_PLANE_PREFIX && !p.startsWith(`${DATA_PLANE_PREFIX}/`);
}

/** Response là HTML shell SPA, không phải JSON API. */
export function looksLikeSpaShell(result: ProxyTryResult): boolean {
  const t = result.bodyText.trim().toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html');
}

function integrationFailureHint(bodyJson: unknown): string | null {
  if (!bodyJson || typeof bodyJson !== 'object') return null;
  const row = bodyJson as Record<string, unknown>;
  if (row.error !== 'integration_proxy_failed') return null;
  const msg = String(row.message ?? '').toLowerCase();
  if (msg.includes('missing access_token') || msg.includes('invalid_code') || msg.includes('invalid_grant')) {
    return 'API Key/HMAC đã qua gateway — lỗi OAuth Zoho/Salesforce (token hết hạn hoặc chưa kết nối). Vào Tích hợp → kết nối lại rồi thử path /sf/... hoặc /zoho/...';
  }
  return 'Gateway chấp nhận key nhưng proxy tích hợp upstream thất bại — kiểm tra Tích hợp và route.';
}

import {
  parseGatewayErrorBody,
  reasonLabel,
  inferMiddlewareStage,
  MIDDLEWARE_STAGE_VI,
} from './middlewareLabels';

export function describeProxyExpectation(result: ProxyTryResult, mode: 'no_key' | 'with_key'): string {
  const gwErr = parseGatewayErrorBody(result.bodyJson);
  const errCode = gwErr?.error ?? '';

  if (looksLikeSpaShell(result)) {
    return `HTTP ${result.status} nhưng body là HTML giao diện — không phải API. Dùng path dạng ${DATA_PLANE_PREFIX}/... (có dấu / sau api).`;
  }

  if (mode === 'no_key') {
    if (result.status === 401) {
      return 'Middleware dừng tại Authentication — thiếu X-API-Key / HMAC.';
    }
    if (result.status === 404) {
      if (isDataPlaneTypoPath(result.requestUrl)) {
        return `404 Routing — path sai định dạng; cần ${DATA_PLANE_PREFIX}/<segment>.`;
      }
      return '404 Routing — chưa cấu hình route khớp path.';
    }
    return `Nhận HTTP ${result.status}; kỳ vọng 401 tại bước Authentication.`;
  }

  if (result.status === 401) {
    if (errCode === 'invalid_signature' || errCode === 'replay_detected') {
      return `Authentication — ${reasonLabel(errCode)}. Kiểm tra Secret (avaso_sk_...) và đồng hồ hệ thống (±5 phút).`;
    }
    if (errCode === 'missing_or_invalid_api_key') {
      return 'Authentication — gateway không nhận API Key này. Copy lại từ Client Registry (cột API Key) hoặc chọn client ở dropdown; nếu vẫn lỗi thì tạo client mới hoặc reload gateway. Lỗi này không phải do Secret sai.';
    }
    return 'Authentication — thiếu hoặc sai credential.';
  }

  if (result.status === 403) {
    if (errCode === 'client_key_disabled') {
      return 'Authorization — client bị tắt trong Client Registry. Bật lại hoặc tạo key mới.';
    }
    if (errCode === 'forbidden' || gwErr?.message?.includes('route')) {
      return 'Authorization — client không có quyền route này. Cấu hình ACL tại Client Registry.';
    }
    return 'Authorization — tenant hoặc chính sách từ chối request.';
  }

  if (result.status === 429) {
    return 'Rate limiting — vượt giới hạn (client → route → global). Đợi Retry-After hoặc tăng quota.';
  }

  if (result.status === 404) {
    if (isDataPlaneTypoPath(result.requestUrl)) {
      return `Routing — path sai định dạng; cần ${DATA_PLANE_PREFIX}/<segment>.`;
    }
    return 'Routing — không có route khớp. Thêm route tại Quản lý Route.';
  }

  if (result.ok && result.bodyJson != null) {
    const stage = inferMiddlewareStage(result.status, errCode, 'success');
    return `Qua middleware (${MIDDLEWARE_STAGE_VI[stage]}) — gateway forward upstream.`;
  }

  if (result.ok) {
    return `HTTP ${result.status} — đã qua middleware; body không phải JSON.`;
  }

  const integrationHint = integrationFailureHint(result.bodyJson);
  if (integrationHint) return integrationHint;

  if (result.status === 502) {
    return 'Upstream — gateway đã xác thực nhưng upstream không phản hồi hợp lệ.';
  }

  if (gwErr?.message) {
    return `${reasonLabel(errCode)} — ${gwErr.message}`;
  }

  return `HTTP ${result.status} — xem body JSON bên dưới.`;
}
