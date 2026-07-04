export type HttpMethodOption = {
  method: string;
  hint: string;
};

/** Khớp `route_match::validate_allowed_methods` trên backend. */
export const HTTP_METHOD_OPTIONS: HttpMethodOption[] = [
  { method: 'GET', hint: 'Đọc dữ liệu' },
  { method: 'POST', hint: 'Tạo mới / gửi payload' },
  { method: 'PUT', hint: 'Thay thế toàn bộ resource' },
  { method: 'PATCH', hint: 'Cập nhật một phần' },
  { method: 'DELETE', hint: 'Xóa resource' },
  { method: 'HEAD', hint: 'Metadata, không body' },
  { method: 'OPTIONS', hint: 'CORS / preflight' },
];

export const DEFAULT_ALLOWED_METHODS = '*';

const KNOWN = new Set(HTTP_METHOD_OPTIONS.map((o) => o.method));
const ORDER = HTTP_METHOD_OPTIONS.map((o) => o.method);

export function isAllMethodsAllowed(raw: string): boolean {
  const t = raw.trim();
  return !t || t === '*';
}

export function parseAllowedMethods(raw: string): string[] {
  if (isAllMethodsAllowed(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const m = part.trim().toUpperCase();
    if (m && !seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

export function formatAllowedMethods(methods: readonly string[]): string {
  if (methods.length === 0) return '*';
  return [...methods].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join(',');
}

export function allKnownMethods(): string[] {
  return [...ORDER];
}

export function toggleAllowedMethod(raw: string, method: string, checked: boolean): string {
  const all = allKnownMethods();
  const current = isAllMethodsAllowed(raw) ? [...all] : parseAllowedMethods(raw);
  const set = new Set(current);
  const m = method.toUpperCase();
  if (checked) set.add(m);
  else set.delete(m);
  const next = all.filter((x) => set.has(x));
  if (next.length === 0 || next.length === all.length) return '*';
  return next.join(',');
}

export function setAllowAllMethods(): string {
  return '*';
}

/** Khi tắt "tất cả", mặc định chỉ GET — phù hợp demo read-only. */
export function defaultRestrictedMethods(): string {
  return 'GET';
}

export function formatAllowedMethodsLabel(raw: string): string {
  if (isAllMethodsAllowed(raw)) return 'Tất cả';
  return parseAllowedMethods(raw).join(', ');
}

export function unknownMethods(raw: string): string[] {
  return parseAllowedMethods(raw).filter((m) => !KNOWN.has(m));
}
