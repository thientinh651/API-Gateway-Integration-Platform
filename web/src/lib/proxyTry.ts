import { fetchOAuthTokenClientCredentials } from './oauthToken';

export const DATA_PLANE_PREFIX = '/v1/api';

export type ProxyTryResult = {
  ok: boolean;
  status: number;
  statusText: string;
  elapsedMs: number;
  bodyText: string;
  bodyJson: unknown | null;
  sentToken: boolean;
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
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
}): Promise<ProxyTryResult> {
  const method = (options.method || 'GET').toUpperCase();
  const requestUrl = normalizePath(options.path);
  const headers: HeadersInit = {};

  let token = options.accessToken?.trim() ?? '';
  const clientId = options.clientId?.trim() ?? '';
  const clientSecret = options.clientSecret?.trim() ?? '';

  if (!token && clientId && clientSecret) {
    const t = await fetchOAuthTokenClientCredentials(clientId, clientSecret);
    token = t.access_token;
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
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
    sentToken: Boolean(token),
    requestUrl,
    method,
  };
}

/** Path bắt đầu bằng prefix nhưng thiếu `/` sau `api` (vd `/v1/api123`). */
export function isDataPlaneTypoPath(path: string): boolean {
  const p = normalizePath(path);
  return p.startsWith(DATA_PLANE_PREFIX) && p !== DATA_PLANE_PREFIX && !p.startsWith(`${DATA_PLANE_PREFIX}/`);
}

function isHtmlBody(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html');
}

/** HTML lỗi mặc định từ Nginx (502/503/504) — không phải SPA. */
export function looksLikeNginxGatewayError(result: ProxyTryResult): boolean {
  if (!isHtmlBody(result.bodyText)) return false;
  const t = result.bodyText.toLowerCase();
  if (t.includes('nginx')) return true;
  if (result.status < 502 || result.status > 504) return false;
  return (
    t.includes('bad gateway') ||
    t.includes('gateway time') ||
    t.includes('service temporarily') ||
    t.includes('503 service')
  );
}

/**
 * Response là HTML shell SPA (fallback index), không phải JSON API.
 * Loại trừ trang lỗi Nginx — trước đây 502 HTML bị nhầm thành “path sai”.
 */
export function looksLikeSpaShell(result: ProxyTryResult): boolean {
  if (!isHtmlBody(result.bodyText)) return false;
  if (looksLikeNginxGatewayError(result)) return false;
  return true;
}

function integrationFailureHint(bodyJson: unknown): string | null {
  if (!bodyJson || typeof bodyJson !== 'object') return null;
  const row = bodyJson as Record<string, unknown>;
  if (row.error !== 'integration_proxy_failed') return null;
  const msg = String(row.message ?? '').toLowerCase();
  if (msg.includes('missing access_token') || msg.includes('invalid_code') || msg.includes('invalid_grant')) {
    return 'JWT đã qua gateway — lỗi OAuth Zoho/Salesforce (token hết hạn hoặc chưa kết nối). Vào Tích hợp → kết nối lại.';
  }
  return 'Gateway chấp nhận token nhưng proxy tích hợp upstream thất bại — kiểm tra Tích hợp và route.';
}

import {
  parseGatewayErrorBody,
  reasonLabel,
  inferMiddlewareStage,
  isUpstreamProviderBody,
  MIDDLEWARE_STAGE_VI,
} from './middlewareLabels';

export function describeProxyExpectation(result: ProxyTryResult, mode: 'no_token' | 'with_token'): string {
  const gwErr = parseGatewayErrorBody(result.bodyJson);
  const errCode = gwErr?.error ?? '';

  if (looksLikeNginxGatewayError(result)) {
    return `HTTP ${result.status} từ Nginx — gateway backend không phản hồi (process dừng hoặc sai port proxy_pass). Kiểm tra systemctl status avaso-gateway / curl 127.0.0.1:3000/health.`;
  }

  if (looksLikeSpaShell(result)) {
    return `HTTP ${result.status} nhưng body là HTML giao diện — không phải API. Dùng path dạng ${DATA_PLANE_PREFIX}/... (có dấu / sau api).`;
  }

  if (mode === 'no_token') {
    if (result.status === 401) {
      return 'Middleware dừng tại Authentication — thiếu Authorization: Bearer token.';
    }
    if (result.status === 404) {
      if (isDataPlaneTypoPath(result.requestUrl)) {
        return `404 Routing — path sai định dạng; cần ${DATA_PLANE_PREFIX}/<segment>.`;
      }
      return '404 Routing — chưa cấu hình route khớp path.';
    }
    return `Nhận HTTP ${result.status}; kỳ vọng 401 tại bước Authentication.`;
  }

  if (result.status === 401 && isUpstreamProviderBody(result.bodyJson)) {
    return 'Đã qua gateway — upstream trả 401. Kiểm tra query (appid, q, …) hoặc Upstream URL route (base URL, không dính ?).';
  }

  if (result.status === 401) {
    if (errCode === 'token_expired') {
      return 'Authentication — access token hết hạn. Lấy token mới qua POST /oauth/token.';
    }
    if (errCode === 'invalid_token' || errCode === 'missing_token') {
      return 'Authentication — token không hợp lệ hoặc thiếu Bearer header.';
    }
    return 'Authentication — thiếu hoặc sai access token.';
  }

  if (result.status === 403) {
    if (errCode === 'client_key_disabled') {
      return 'Authorization — OAuth client bị tắt trong Client Registry. Bật lại hoặc tạo client mới.';
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
    const stage = inferMiddlewareStage(result.status, errCode, 'success', result.bodyJson);
    return `Qua middleware (${MIDDLEWARE_STAGE_VI[stage]}) — gateway forward upstream.`;
  }

  if (!result.ok && isUpstreamProviderBody(result.bodyJson)) {
    return `Upstream trả HTTP ${result.status} — gateway đã forward; xem body JSON bên dưới.`;
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
