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

export function describeProxyExpectation(result: ProxyTryResult, mode: 'no_key' | 'with_key'): string {
  if (looksLikeSpaShell(result)) {
    return `HTTP ${result.status} nhưng body là HTML giao diện — không phải API. Dùng path dạng ${DATA_PLANE_PREFIX}/... (có dấu / sau api).`;
  }
  if (mode === 'no_key') {
    if (result.status === 401) return 'Đúng kỳ vọng SRS: 401 khi thiếu X-API-Key (FR-F1 / FR-F3).';
    if (result.status === 404) {
      if (isDataPlaneTypoPath(result.requestUrl)) {
        return `404 — path sai định dạng; cần ${DATA_PLANE_PREFIX} hoặc ${DATA_PLANE_PREFIX}/<segment>.`;
      }
      return '404 — kiểm tra path và route trên Quản lý Route.';
    }
    return `Nhận HTTP ${result.status}; kỳ vọng thường là 401.`;
  }
  if (result.ok && result.bodyJson != null) {
    return 'Đúng kỳ vọng: key hợp lệ, gateway forward upstream (FR-F2).';
  }
  if (result.ok) {
    return `HTTP ${result.status} — body không phải JSON; kiểm tra route/upstream trên Quản lý Route.`;
  }
  if (result.status === 401) return '401 — key sai hoặc đã xóa trên Auth.';
  if (result.status === 404) {
    if (isDataPlaneTypoPath(result.requestUrl)) {
      return `404 — path sai định dạng; cần ${DATA_PLANE_PREFIX} hoặc ${DATA_PLANE_PREFIX}/<segment>.`;
    }
    return '404 — không có route khớp path.';
  }
  return `HTTP ${result.status} — xem body bên dưới.`;
}
