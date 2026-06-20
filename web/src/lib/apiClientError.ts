import { toast } from 'sonner';
import { normalizeApiPath, resolveApiErrorTarget, type ApiErrorTarget } from './apiErrorTarget';
import { isSessionExpiredRedirect } from './sessionExpiry';
import { goToApiErrorTarget } from './toastNavigation';

export type ApiErrorBody = {
  error?: string;
  message?: string;
  fields?: Record<string, string>;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly apiPath?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
    apiPath?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.apiPath = apiPath;
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

export function parseApiError(status: number, bodyText: string, apiPath?: string): ApiClientError {
  try {
    const j = JSON.parse(bodyText) as ApiErrorBody;
    const code = j.error ?? 'unknown';
    const message = j.message ?? friendlyHttpMessage(status, bodyText);
    return new ApiClientError(status, code, message, j.fields, apiPath);
  } catch {
    return new ApiClientError(status, 'unknown', friendlyHttpMessage(status, bodyText), undefined, apiPath);
  }
}

export function formatApiErrorToast(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.status === 404 && isMissingBackendApi(e)) {
      const path = e.apiPath ? normalizeApiPath(e.apiPath) : '';
      if (path.includes('/integrations/transform')) {
        return 'Transform API chưa có trên server — deploy binary gateway mới. Sync Opportunity→Zoho vẫn chạy bình thường.';
      }
      return path
        ? `API ${path} chưa có trên server — cần deploy bản gateway (Rust) mới.`
        : 'API chưa có trên server — cần deploy bản gateway mới.';
    }
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 404 do backend production cũ — không phải lỗi X-API-Key. */
export function isMissingBackendApi(e: unknown): boolean {
  if (!(e instanceof ApiClientError) || e.status !== 404) return false;
  if (e.code === 'not_found') return true;
  return e.message.includes('Admin API is mounted');
}

export type ToastApiErrorOptions = Partial<ApiErrorTarget> & {
  apiPath?: string;
  /** Không hiện toast (chỉ dùng khi UI đã hiển thị inline). */
  quiet?: boolean;
};

function resolveToastTarget(e: unknown, options?: ToastApiErrorOptions): ApiErrorTarget | null {
  if (options?.route && options.label) {
    return {
      route: options.route,
      sectionId: options.sectionId,
      label: options.label,
    };
  }
  const path = options?.apiPath ?? (e instanceof ApiClientError ? e.apiPath : undefined);
  return resolveApiErrorTarget(path);
}

function showErrorToast(msg: string, target: ApiErrorTarget | null) {
  const jump = () => {
    if (target) goToApiErrorTarget(target);
  };

  if (!target) {
    toast.error(msg);
    return;
  }

  toast.error(msg, {
    classNames: { toast: 'cursor-pointer' },
    action: target
      ? {
          label: 'Mở',
          onClick: jump,
        }
      : undefined,
    onClick: (ev) => {
      const t = ev.target as HTMLElement | null;
      if (t?.closest('[data-close-button]')) return;
      jump();
    },
  });
}

/** Không toast khi đang redirect vì session hết hạn. */
export function toastApiError(e: unknown, options?: ToastApiErrorOptions) {
  if (isSessionExpiredRedirect() || options?.quiet) return;
  const msg = formatApiErrorToast(e);
  if (!msg) return;
  showErrorToast(msg, resolveToastTarget(e, options));
}
