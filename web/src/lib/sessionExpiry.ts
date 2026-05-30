type ExpiryHandler = () => void;

let sessionActive = false;
let redirecting = false;
let handler: ExpiryHandler | null = null;

export function setSessionActive(active: boolean) {
  sessionActive = active;
  if (!active) redirecting = false;
}

export function registerSessionExpiryHandler(h: ExpiryHandler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

export function isSessionExpiredRedirect(): boolean {
  return redirecting;
}

function apiPath(input: string): string {
  try {
    const u = input.startsWith('http') ? new URL(input) : new URL(input, window.location.origin);
    return u.pathname;
  } catch {
    return input.split('?')[0] ?? input;
  }
}

export function shouldForceLogout(input: string): boolean {
  if (!sessionActive || redirecting) return false;
  const path = apiPath(input);
  if (path.endsWith('/api/login') || path.endsWith('/api/logout')) return false;
  return path.startsWith('/api/');
}

/** Test-only reset — không gọi từ app. */
export function resetSessionExpiryForTests() {
  sessionActive = false;
  redirecting = false;
  handler = null;
}

export function forceLogoutOnSessionExpired() {
  if (!sessionActive || redirecting) return;
  redirecting = true;
  sessionActive = false;
  handler?.();
  if (typeof window !== 'undefined') {
    window.location.replace('/login?expired=1');
  }
}
