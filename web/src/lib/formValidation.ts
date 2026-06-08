import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import { ApiClientError, toastApiError } from './apiClientError';
import { isSessionExpiredRedirect } from './sessionExpiry';

export const FORM_CHECK_MESSAGE = 'Vui lòng kiểm tra các ô được đánh dấu.';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Khớp logic `password_reset::normalize_email` phía server. */
export function isValidEmail(raw: string): boolean {
  const e = raw.trim().toLowerCase();
  return e.length > 0 && e.length <= 254 && EMAIL_RE.test(e);
}

export function applyApiFieldErrors(fields?: Record<string, string>): Record<string, string> {
  return fields ? { ...fields } : {};
}

/** Lỗi tại từng field; toast chỉ message tổng quát. Trả true nếu đã xử lý field errors. */
export function handleFormApiError(
  e: unknown,
  setFieldErrors: (fields: Record<string, string>) => void,
  summaryMessage?: string,
): boolean {
  if (isSessionExpiredRedirect()) return true;

  if (e instanceof ApiClientError && e.fields && Object.keys(e.fields).length > 0) {
    setFieldErrors(applyApiFieldErrors(e.fields));
    toast.error(summaryMessage ?? e.message);
    return true;
  }

  toastApiError(e);
  return false;
}

export function failClientValidation(
  setFieldErrors: (fields: Record<string, string>) => void,
  errors: Record<string, string>,
  summaryMessage: string = FORM_CHECK_MESSAGE,
) {
  setFieldErrors(errors);
  toast.error(summaryMessage);
}

export function clearOneFieldError(
  setFieldErrors: Dispatch<SetStateAction<Record<string, string>>>,
  field: string,
) {
  setFieldErrors((prev) => {
    if (!prev[field]) return prev;
    const next = { ...prev };
    delete next[field];
    return next;
  });
}

export function fieldInputErrorClass(hasError: boolean, base = ''): string {
  return hasError ? `${base} border-destructive`.trim() : base;
}
