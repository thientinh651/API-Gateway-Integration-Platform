/** Client key plaintext chỉ để thử data-plane trên trang Thử proxy (sessionStorage, không gửi server). */

export const TEST_CLIENT_KEY_STORAGE = 'gw_test_client_key';

export function getTestClientKey(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem(TEST_CLIENT_KEY_STORAGE) ?? '';
}

export function setTestClientKey(key: string | null) {
  if (typeof window === 'undefined') return;
  if (key) sessionStorage.setItem(TEST_CLIENT_KEY_STORAGE, key);
  else sessionStorage.removeItem(TEST_CLIENT_KEY_STORAGE);
}
