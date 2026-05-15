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
}): Promise<ProxyTryResult> {
  const method = (options.method || 'GET').toUpperCase();
  const requestUrl = normalizePath(options.path);
  const key = options.apiKey?.trim() ?? '';
  const headers: HeadersInit = {};
  if (key) headers['X-API-Key'] = key;

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

export function describeProxyExpectation(result: ProxyTryResult, mode: 'no_key' | 'with_key'): string {
  if (mode === 'no_key') {
    if (result.status === 401) return 'Đúng kỳ vọng SRS: 401 khi thiếu X-API-Key (FR-F1 / FR-F3).';
    if (result.status === 404) return '404 — kiểm tra path và route trên Quản lý Route.';
    return `Nhận HTTP ${result.status}; kỳ vọng thường là 401.`;
  }
  if (result.ok) return 'Đúng kỳ vọng: key hợp lệ, gateway forward upstream (FR-F2).';
  if (result.status === 401) return '401 — key sai hoặc đã xóa trên Auth.';
  if (result.status === 404) return '404 — không có route khớp path.';
  return `HTTP ${result.status} — xem body bên dưới.`;
}
