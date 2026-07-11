/**
 * Sanitize `return_to` query after login — same-origin relative paths only.
 * Blocks open redirects (//evil, https://…).
 */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const decoded = raw.trim();
  if (!decoded) return null;
  if (!decoded.startsWith('/')) return null;
  if (decoded.startsWith('//')) return null;
  if (decoded.includes('://')) return null;
  const pathOnly = decoded.split(/[?#]/, 1)[0] ?? '';
  if (pathOnly === '/login' || pathOnly.startsWith('/login/')) return null;
  return decoded;
}

/** After login: `/oauth/*` is backend (full navigation); other paths use SPA navigate. */
export function goAfterLogin(
  returnTo: string | null | undefined,
  navigate: (to: string, opts?: { replace?: boolean }) => void,
): void {
  const safe = sanitizeReturnTo(returnTo);
  if (!safe) {
    navigate('/', { replace: true });
    return;
  }
  if (safe.startsWith('/oauth/')) {
    window.location.assign(safe);
    return;
  }
  navigate(safe, { replace: true });
}
