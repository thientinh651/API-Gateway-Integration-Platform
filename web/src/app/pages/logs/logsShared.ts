export function getStatusBadgeClass(status: number): string {
  if (status >= 200 && status < 300) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (status >= 400 && status < 500) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  if (status >= 500) return 'bg-red-500/10 text-red-400 border-red-500/20';
  return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
}

export function getMethodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    POST: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    PUT: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    DELETE: 'bg-red-500/10 text-red-400 border-red-500/20',
    PATCH: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  };
  return colors[method] || 'bg-slate-500/10 text-slate-400 border-slate-500/20';
}

export const HTTP_STATUS_FILTER_HINT: Record<string, string> = {
  all: 'Mọi mã phản hồi HTTP',
  '2xx': 'Thành công — 200, 201… (request OK)',
  '4xx': 'Lỗi phía client — 401 auth, 404 route, 429 rate limit…',
  '5xx': 'Lỗi upstream/server — 502, 504 timeout…',
};

/** Pretty-print JSON if the text parses as JSON, else return as-is. */
export function prettyMaybeJson(text: string | null | undefined): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
