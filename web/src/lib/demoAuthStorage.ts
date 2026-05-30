export const SAVED_USERNAME_KEY = 'gw_saved_username';

export function getSavedUsername(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SAVED_USERNAME_KEY);
}

export function setSavedUsername(username: string | null) {
  if (typeof window === 'undefined') return;
  if (username) localStorage.setItem(SAVED_USERNAME_KEY, username);
  else localStorage.removeItem(SAVED_USERNAME_KEY);
}
