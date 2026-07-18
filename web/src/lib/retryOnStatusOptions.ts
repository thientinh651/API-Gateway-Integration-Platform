export type RetryOnStatusOption = {
  code: number;
  /** Nhãn ngắn trên chip */
  label: string;
  hint: string;
};

/** Mã HTTP thường dùng cho retry upstream (lỗi tạm thời). */
export const RETRY_ON_STATUS_OPTIONS: RetryOnStatusOption[] = [
  { code: 502, label: '502', hint: 'Bad Gateway — upstream/proxy lỗi' },
  { code: 503, label: '503', hint: 'Service Unavailable — bảo trì / quá tải' },
  { code: 504, label: '504', hint: 'Gateway Timeout — upstream không kịp trả lời' },
  { code: 500, label: '500', hint: 'Internal Server Error — lỗi server upstream' },
  { code: 429, label: '429', hint: 'Too Many Requests — rate limit upstream' },
  { code: 408, label: '408', hint: 'Request Timeout — phản hồi quá chậm' },
];

export const DEFAULT_RETRY_ON_STATUS = '502,503,504';

const PRESET_CODES = new Set(RETRY_ON_STATUS_OPTIONS.map((o) => o.code));

export function parseRetryOnStatus(raw: string): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n >= 100 && n <= 599 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out.sort((a, b) => a - b);
}

export function formatRetryOnStatus(codes: readonly number[]): string {
  return [...codes].sort((a, b) => a - b).join(',');
}

export function unknownRetryStatusCodes(codes: readonly number[]): number[] {
  return codes.filter((c) => !PRESET_CODES.has(c));
}

export function toggleRetryOnStatus(raw: string, code: number, checked: boolean): string {
  const set = new Set(parseRetryOnStatus(raw));
  if (checked) set.add(code);
  else set.delete(code);
  return formatRetryOnStatus([...set]);
}

/** Chuyển mảng API → chuỗi form CSV. */
export function retryOnStatusFromApi(raw: number[] | string | undefined | null): string {
  if (raw == null) return DEFAULT_RETRY_ON_STATUS;
  if (typeof raw === 'string') return raw.trim() || DEFAULT_RETRY_ON_STATUS;
  return formatRetryOnStatus(raw);
}

export function retryStatusHintForCode(code: number): string | undefined {
  return RETRY_ON_STATUS_OPTIONS.find((o) => o.code === code)?.hint;
}
