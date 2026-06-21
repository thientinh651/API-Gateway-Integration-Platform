const GATEWAY_ORIGIN =
  import.meta.env.VITE_GATEWAY_ORIGIN?.replace(/\/$/, '') ||
  import.meta.env.VITE_API_BASE_URL?.replace(/\/api\/?$/, '').replace(/\/$/, '') ||
  '';

export type OAuthTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export async function fetchOAuthTokenClientCredentials(
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokenResponse> {
  const base = GATEWAY_ORIGIN || window.location.origin;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
  });
  const res = await fetch(`${base}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as OAuthTokenResponse & {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `Token HTTP ${res.status}`);
  }
  if (!json.access_token) {
    throw new Error('Token response thiếu access_token');
  }
  return json;
}

export async function fetchOAuthTokenPassword(
  username: string,
  password: string,
): Promise<OAuthTokenResponse> {
  const base = GATEWAY_ORIGIN || window.location.origin;
  const body = new URLSearchParams({
    grant_type: 'password',
    username: username.trim(),
    password,
  });
  const res = await fetch(`${base}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as OAuthTokenResponse & {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `Token HTTP ${res.status}`);
  }
  if (!json.access_token) {
    throw new Error('Token response thiếu access_token');
  }
  return json;
}
