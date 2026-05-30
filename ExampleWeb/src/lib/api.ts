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

export type AdminMe = {
  username: string;
  role?: string;
  tenant_id?: number;
  user_id?: number;
};

export async function adminMe(): Promise<AdminMe> {
  return fetchJson<AdminMe>('/api/me');
}

export async function adminLogin(body: { username: string; password: string }): Promise<AdminMe> {
  const j = await fetchJson<{ status: string; username: string }>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    username: j.username,
    role: (j as { role?: string }).role,
    tenant_id: (j as { tenant_id?: number }).tenant_id,
    user_id: (j as { user_id?: number }).user_id,
  };
}

export async function adminLogout(): Promise<void> {
  return fetchOk('/api/logout', { method: 'POST' });
}

function adminHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  const envKey = import.meta.env.VITE_ADMIN_X_API_KEY as string | undefined;
  const storedKey =
    typeof window !== 'undefined' ? window.localStorage.getItem('admin_api_key') ?? undefined : undefined;
  const key = envKey?.trim() || storedKey?.trim();
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

export type RouteWriteBody = {
  path: string;
  target: string;
  timeout_secs: number;
  rate_limit_per_min: number;
};

export async function createGatewayRoute(body: RouteWriteBody): Promise<GatewayRouteRow> {
  return fetchJson<GatewayRouteRow>('/api/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function updateGatewayRoute(
  id: number,
  body: RouteWriteBody
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

export type ClientKeyMeta = {
  id: number;
  name: string;
  api_key: string | null;
  auth_mode: string;
  integration_type: string;
  tenant_id: number;
};

export function fetchClientKeys(): Promise<ClientKeyMeta[]> {
  return fetchJson<ClientKeyMeta[]>('/api/client-keys');
}

export type CreateClientKeyResponse = {
  id: number;
  name: string;
  api_key: string;
  secret_key: string;
  auth: string;
  integration_type?: string;
  tenant_id?: number;
  purpose?: string;
};

export async function createClientKey(
  name: string,
  integrationType: string
): Promise<CreateClientKeyResponse> {
  return fetchJson<CreateClientKeyResponse>('/api/client-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, integration_type: integrationType }),
  });
}

export type GatewayPublicKey = {
  key_id: string;
  algorithm: string;
  rsa_padding: string;
  aes: string;
  public_key_pem: string;
  usage: string;
};

/** Public — partner apps fetch before encrypting sensitive payloads. */
export function fetchGatewayPublicKey(): Promise<GatewayPublicKey> {
  return fetch(apiUrl('/api/crypto/public-key')).then(async (r) => {
    const t = await r.text();
    if (!r.ok) throw parseApiError(r.status, t);
    return JSON.parse(t) as GatewayPublicKey;
  });
}

export type CryptoEnvelope = {
  encrypted_aes_key: string;
  nonce: string;
  ciphertext: string;
};

export async function createClientKeyEncrypted(
  envelope: CryptoEnvelope
): Promise<CreateClientKeyResponse> {
  return fetchJson<CreateClientKeyResponse>('/api/client-keys/encrypted', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envelope }),
  });
}

export type AdminUserRow = {
  id: number;
  username: string;
  role: string;
  tenant_id: number;
  is_active: boolean;
  created_at: string;
};

export function fetchAdminUsers(): Promise<AdminUserRow[]> {
  return fetchJson<AdminUserRow[]>('/api/users');
}

export async function createAdminUser(body: {
  username: string;
  password: string;
  role: string;
}): Promise<AdminUserRow> {
  return fetchJson<AdminUserRow>('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function updateAdminUser(
  id: number,
  body: {
    username: string;
    role: string;
    is_active: boolean;
    password?: string;
  }
): Promise<AdminUserRow> {
  return fetchJson<AdminUserRow>(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteAdminUser(id: number): Promise<void> {
  return fetchOk(`/api/users/${id}`, { method: 'DELETE' });
}

export type AuditLogRow = {
  id: number;
  tenant_id: number;
  actor: string;
  role: string;
  action: string;
  resource: string;
  result: string;
  source_ip: string | null;
  details: string | null;
  created_at: string;
};

export function fetchAuditLogs(): Promise<AuditLogRow[]> {
  return fetchJson<AuditLogRow[]>('/api/audit-logs');
}

export type GatewaySettings = {
  rate_limit_enabled: boolean;
  rate_limit_rps: number;
  rate_limit_burst: number;
  enable_metrics: boolean;
  enable_health_check: boolean;
  system_info: {
    version: string;
    runtime: string;
    database: string;
    bind_port: number;
    log_format: string;
    has_admin_api_key: boolean;
  };
};

export type GatewaySettingsWriteBody = {
  rate_limit_enabled: boolean;
  rate_limit_rps: number;
  rate_limit_burst: number;
  enable_metrics: boolean;
  enable_health_check: boolean;
};

export function fetchGatewaySettings(): Promise<GatewaySettings> {
  return fetchJson<GatewaySettings>('/api/settings');
}

export function updateGatewaySettings(body: GatewaySettingsWriteBody): Promise<GatewaySettings> {
  return fetchJson<GatewaySettings>('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export type IntegrationRow = {
  id: number;
  provider: string;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
  updated_at: string;
  label: string;
  available: boolean;
};

export function fetchIntegrations(): Promise<IntegrationRow[]> {
  return fetchJson<IntegrationRow[]>('/api/integrations');
}

export function salesforceConnectUrl(): string {
  return apiUrl('/api/integrations/salesforce/connect');
}

export async function salesforceTest(): Promise<{ status: string; limits: unknown }> {
  return fetchJson<{ status: string; limits: unknown }>('/api/integrations/salesforce/test');
}

export async function salesforceSync(): Promise<{
  status: string;
  summary: { provider: string; opportunity: number; account: number };
}> {
  return fetchJson('/api/integrations/salesforce/sync', { method: 'POST' });
}

export async function salesforceDisconnect(): Promise<void> {
  return fetchOk('/api/integrations/salesforce/disconnect', { method: 'POST' });
}

export type SalesforceProviderConfigPublic = {
  client_id: string;
  redirect_uri: string;
  login_url: string;
  has_secret: boolean;
  secret_masked?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
};

export type SalesforceProviderConfigWriteBody = {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  login_url: string;
};

export function fetchSfConfig(): Promise<SalesforceProviderConfigPublic> {
  return fetchJson<SalesforceProviderConfigPublic>('/api/integrations/salesforce/config');
}

export function updateSfConfig(
  body: SalesforceProviderConfigWriteBody
): Promise<SalesforceProviderConfigPublic> {
  return fetchJson<SalesforceProviderConfigPublic>('/api/integrations/salesforce/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function zohoConnectUrl(): string {
  return apiUrl('/api/integrations/zoho/connect');
}

export async function zohoTest(): Promise<{
  status: string;
  portals: unknown;
  portal_id?: string | null;
}> {
  return fetchJson<{ status: string; portals: unknown; portal_id?: string | null }>(
    '/api/integrations/zoho/test'
  );
}

export async function zohoSync(): Promise<{
  status: string;
  summary: { provider: string; portal_id?: string; project: number; task: number };
}> {
  return fetchJson('/api/integrations/zoho/sync', { method: 'POST' });
}

export type IntegrationSnapshotSummary = {
  provider: string;
  entity_type: string;
  record_count: number;
  fetched_at: string;
};

export function fetchIntegrationSnapshots(provider?: string): Promise<IntegrationSnapshotSummary[]> {
  const q = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  return fetchJson<IntegrationSnapshotSummary[]>(`/api/integrations/snapshots${q}`);
}

export type DashboardStats = {
  routes_count: number;
  client_keys_count: number;
  audit_24h: { total: number; success: number; failure: number };
  integrations: IntegrationRow[];
  snapshot_entities: Array<{
    provider: string;
    entity_type: string;
    label: string;
    record_count: number;
    fetched_at: string;
  }>;
  snapshot_timeline: Array<{
    fetched_at: string;
    provider: string;
    entity_type: string;
    record_count: number;
  }>;
  salesforce_stages: Array<{ label: string; count: number }>;
  zoho_project_status: Array<{ label: string; count: number }>;
  total_snapshot_records: number;
};

export function fetchDashboardStats(): Promise<DashboardStats> {
  return fetchJson<DashboardStats>('/api/dashboard/stats');
}

export async function zohoDisconnect(): Promise<void> {
  return fetchOk('/api/integrations/zoho/disconnect', { method: 'POST' });
}

export type ZohoProviderConfigPublic = {
  client_id: string;
  redirect_uri: string;
  accounts_url: string;
  scopes: string;
  has_secret: boolean;
  secret_masked?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
};

export type ZohoProviderConfigWriteBody = {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  accounts_url: string;
  scopes: string;
};

export function fetchZohoConfig(): Promise<ZohoProviderConfigPublic> {
  return fetchJson<ZohoProviderConfigPublic>('/api/integrations/zoho/config');
}

export function updateZohoConfig(body: ZohoProviderConfigWriteBody): Promise<ZohoProviderConfigPublic> {
  return fetchJson<ZohoProviderConfigPublic>('/api/integrations/zoho/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function zohoProjects(): Promise<{
  status: string;
  portal_id: string;
  projects: unknown;
}> {
  return fetchJson<{ status: string; portal_id: string; projects: unknown }>(
    '/api/integrations/zoho/projects'
  );
}

export async function zohoTasks(projectId: string): Promise<{
  status: string;
  portal_id: string;
  project_id: string;
  tasks: unknown;
}> {
  const pid = encodeURIComponent(projectId);
  return fetchJson<{ status: string; portal_id: string; project_id: string; tasks: unknown }>(
    `/api/integrations/zoho/tasks?project_id=${pid}`
  );
}

export async function deleteClientKey(id: number): Promise<void> {
  return fetchOk(`/api/client-keys/${id}`, { method: 'DELETE' });
}
