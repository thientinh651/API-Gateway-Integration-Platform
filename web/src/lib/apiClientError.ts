import { toast } from 'sonner';
import { isSessionExpiredRedirect } from './sessionExpiry';

export type ApiErrorBody = {
  error?: string;
  message?: string;
  fields?: Record<string, string>;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function sanitizeErrorBody(text: string): string {
  const t = text.trim();
  if (!t) return '';
  if (/<!doctype|<html/i.test(t)) {
    const title = t.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    if (title) return title;
    return 'Máy chủ trả về trang lỗi HTML (không phải JSON API)';
  }
  if (t.length > 240) return `${t.slice(0, 240)}…`;
  return t;
}

function friendlyHttpMessage(status: number, raw: string): string {
  const detail = sanitizeErrorBody(raw);
  if (status === 502) {
    return 'Gateway tạm ngưng (502) — đợi vài giây rồi thử lại. Key có thể đã tạo: bấm Làm mới danh sách.';
  }
  if (status === 503) return 'Dịch vụ đang bận (503) — thử lại sau.';
  if (status === 504) return 'Hết thời gian chờ phản hồi (504).';
  if (detail && !detail.includes('<')) return detail;
  return `Lỗi HTTP ${status}`;
}

export function parseApiError(status: number, bodyText: string): ApiClientError {
  try {
    const j = JSON.parse(bodyText) as ApiErrorBody;
    const code = j.error ?? 'unknown';
    const message = j.message ?? friendlyHttpMessage(status, bodyText);
    return new ApiClientError(status, code, message, j.fields);
  } catch {
    return new ApiClientError(status, 'unknown', friendlyHttpMessage(status, bodyText));
  }
}

export function formatApiErrorToast(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Không toast khi đang redirect vì session hết hạn. */
export function toastApiError(e: unknown) {
  if (isSessionExpiredRedirect()) return;
  const msg = formatApiErrorToast(e);
  if (msg) toast.error(msg);
}
