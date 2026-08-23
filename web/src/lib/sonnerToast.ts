import { toast, type ExternalToast } from 'sonner';

/** Success / info / message. */
export const TOAST_DURATION_SUCCESS_MS = 3000;
/** Error / warning — long enough to read, not sticky. */
export const TOAST_DURATION_ERROR_MS = 5000;

type ToastFn = (message: Parameters<typeof toast.success>[0], data?: ExternalToast) => string | number;

function resolveDuration(data: ExternalToast | undefined, fallback: number): number {
  return data?.duration ?? fallback;
}

/**
 * Sonner pauses its timer while the pointer is over the toaster. Admin toasts
 * sit top-right — often under the cursor after a save click — so they never
 * auto-close. Dismiss on our own timeout; X / undo still work.
 */
function withAutoDismiss(fn: ToastFn, fallbackMs: number): ToastFn {
  return (message, data) => {
    const duration = resolveDuration(data, fallbackMs);
    const id = fn(message, { ...data, duration });
    if (Number.isFinite(duration) && duration > 0) {
      window.setTimeout(() => toast.dismiss(id), duration);
    }
    return id;
  };
}

let patched = false;

/** Call once at SPA boot (AppToaster import). toast.custom left untouched. */
export function applySonnerAutoDismiss(): void {
  if (patched) return;
  patched = true;
  toast.success = withAutoDismiss(toast.success, TOAST_DURATION_SUCCESS_MS);
  toast.info = withAutoDismiss(toast.info, TOAST_DURATION_SUCCESS_MS);
  toast.message = withAutoDismiss(toast.message, TOAST_DURATION_SUCCESS_MS);
  toast.error = withAutoDismiss(toast.error, TOAST_DURATION_ERROR_MS);
  toast.warning = withAutoDismiss(toast.warning, TOAST_DURATION_ERROR_MS);
}
