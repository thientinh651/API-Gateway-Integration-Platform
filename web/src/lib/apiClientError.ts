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

export function parseApiError(status: number, bodyText: string): ApiClientError {
  try {
    const j = JSON.parse(bodyText) as ApiErrorBody;
    const code = j.error ?? 'unknown';
    const message = j.message ?? bodyText ?? `HTTP ${status}`;
    return new ApiClientError(status, code, message, j.fields);
  } catch {
    return new ApiClientError(status, 'unknown', bodyText || `HTTP ${status}`);
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
