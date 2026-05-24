/** HMAC pair for Proxy Try page only (sessionStorage). */

const API_KEY = 'gw_test_api_key';
const SECRET_KEY = 'gw_test_secret_key';

export function getTestApiKey(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem(API_KEY) ?? '';
}

export function getTestSecretKey(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem(SECRET_KEY) ?? '';
}

export function setTestHmacKeys(apiKey: string | null, secretKey: string | null) {
  if (typeof window === 'undefined') return;
  if (apiKey) sessionStorage.setItem(API_KEY, apiKey);
  else sessionStorage.removeItem(API_KEY);
  if (secretKey) sessionStorage.setItem(SECRET_KEY, secretKey);
  else sessionStorage.removeItem(SECRET_KEY);
}

/** Legacy single-token key. */
export function getTestClientKey(): string {
  return getTestApiKey();
}

export function setTestClientKey(key: string | null) {
  setTestHmacKeys(key, null);
}
