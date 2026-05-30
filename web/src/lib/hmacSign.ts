/**
 * Canonical string must match gateway `crypto::signing_string`.
 * `path` must include query string, e.g. `/v1/api/get?user_id=123`.
 */
export function buildSigningPayload(
  apiKey: string,
  timestamp: string,
  method: string,
  path: string,
  bodyText: string,
): string {
  const m = method.trim().toUpperCase();
  const body = bodyText ?? '';
  return `${apiKey}\n${timestamp}\n${m}\n${path}\n${body}`;
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function unixTimestampSecs(): string {
  return String(Math.floor(Date.now() / 1000));
}
