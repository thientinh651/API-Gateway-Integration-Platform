import type { GatewayRouteRow } from './gatewayRoutes';
import { ApiClientError, parseApiError } from './apiClientError';

/** Origin API công khai, không dấu / cuối. Để trống → gọi relative `/api/...` (cùng host với trang). */
function apiOrigin(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return (raw ?? '').trim().replace(/\/$/, '');
}

export function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  const o = apiOrigin();
  return o ? `${o}${p}` : p;
}

export type AdminMe = { username: string };

export async function adminMe(): Promise<AdminMe> {
  return fetchJson<AdminMe>('/api/me');
}

export async function adminLogin(body: { username: string; password: string }): Promise<AdminMe> {
  const j = await fetchJson<{ status: string; username: string }>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { username: j.username };
}

export async function adminLogout(): Promise<void> {
  return fetchOk('/api/logout', { method: 'POST' });
}

function adminHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  const key = import.meta.env.VITE_ADMIN_X_API_KEY;
  if (key && !headers.has('x-api-key')) headers.set('x-api-key', key);
  return headers;
}

function adminFetchInit(init?: RequestInit): RequestInit {
  const headers = adminHeaders(init?.headers);
  return { credentials: 'include', ...init, headers };
}

export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(apiUrl(input), adminFetchInit(init));
  const t = await r.text().catch(() => '');
  if (!r.ok) {
    throw parseApiError(r.status, t);
  }
  if (!t) return undefined as T;
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new ApiClientError(r.status, 'invalid_json', `HTTP ${r.status}: body không phải JSON`);
  }
}

export async function fetchOk(input: string, init?: RequestInit): Promise<void> {
  const r = await fetch(apiUrl(input), adminFetchInit(init));
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw parseApiError(r.status, t);
  }
}

export { ApiClientError };

export function fetchGatewayRoutes(): Promise<GatewayRouteRow[]> {
  return fetchJson<GatewayRouteRow[]>('/api/routes');
}

export async function createGatewayRoute(body: { path: string; target: string }): Promise<GatewayRouteRow> {
  return fetchJson<GatewayRouteRow>('/api/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function updateGatewayRoute(
  id: number,
  body: { path: string; target: string }
): Promise<GatewayRouteRow> {
  return fetchJson<GatewayRouteRow>(`/api/routes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteGatewayRoute(id: number): Promise<void> {
  return fetchOk(`/api/routes/${id}`, { method: 'DELETE' });
}

export type ClientKeyMeta = { id: number; name: string };

export function fetchClientKeys(): Promise<ClientKeyMeta[]> {
  return fetchJson<ClientKeyMeta[]>('/api/client-keys');
}

export type CreateClientKeyResponse = { id: number; name: string; api_key: string };

export async function createClientKey(name: string): Promise<CreateClientKeyResponse> {
  return fetchJson<CreateClientKeyResponse>('/api/client-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteClientKey(id: number): Promise<void> {
  return fetchOk(`/api/client-keys/${id}`, { method: 'DELETE' });
}
