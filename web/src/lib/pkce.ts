const PKCE_STORAGE_PREFIX = 'oauth_pkce_';
const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;

export type OAuthPkceSession = {
  verifier: string;
  clientId: string;
  redirectUri: string;
};

export function pkceStorageKey(state: string): string {
  return `${PKCE_STORAGE_PREFIX}${state}`;
}

export function saveOAuthPkceSession(state: string, session: OAuthPkceSession): void {
  sessionStorage.setItem(pkceStorageKey(state), JSON.stringify(session));
}

export function loadOAuthPkceSession(state: string): OAuthPkceSession | null {
  const raw = sessionStorage.getItem(pkceStorageKey(state));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OAuthPkceSession;
    if (!parsed?.verifier || !parsed?.clientId || !parsed?.redirectUri) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearOAuthPkceSession(state: string): void {
  sessionStorage.removeItem(pkceStorageKey(state));
}

function getWebCrypto(): Crypto {
  if (globalThis.crypto?.getRandomValues && globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  // Vitest / older Node without global Web Crypto
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('node:crypto') as { webcrypto: Crypto };
  return webcrypto;
}

function randomVerifierBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  getWebCrypto().getRandomValues(bytes);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generatePkceVerifier(): string {
  return base64UrlEncode(randomVerifierBytes());
}

export async function pkceChallengeS256(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await getWebCrypto().subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export function isValidPkceVerifier(verifier: string): boolean {
  return verifier.length >= 43 && verifier.length <= 128 && UNRESERVED.test(verifier);
}

export function defaultOAuthDemoRedirectUri(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/oauth/demo-callback`;
  }
  return 'https://thientinh.io.vn/oauth/demo-callback';
}
