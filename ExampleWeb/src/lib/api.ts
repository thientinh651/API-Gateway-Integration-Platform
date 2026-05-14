import type { GatewayRouteRow } from './gatewayRoutes';

export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const key = import.meta.env.VITE_ADMIN_X_API_KEY;
  if (key && !headers.has('x-api-key')) headers.set('x-api-key', key);
  const r = await fetch(input, { ...init, headers });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}${t ? `: ${t}` : ''}`);
  }
  return r.json() as Promise<T>;
}

export function fetchGatewayRoutes(): Promise<GatewayRouteRow[]> {
  return fetchJson<GatewayRouteRow[]>('/api/routes');
}
