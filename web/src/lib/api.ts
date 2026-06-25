import type { GatewayRouteRow } from './gatewayRoutes';
import { ApiClientError, parseApiError } from './apiClientError';
import { forceLogoutOnSessionExpired, shouldForceLogout } from './sessionExpiry';

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

export type WorkspaceInfo = {
  tenant_id: number;
  name: string;
  role: string;
  is_home: boolean;
};

export type AdminMe = {
  username: string;
  email?: string | null;
  role?: string;
  tenant_id?: number;
  home_tenant_id?: number;
  user_id?: number;
  workspaces?: WorkspaceInfo[];
};

export async function switchWorkspace(tenantId: number): Promise<{ status: string; tenant_id: number; role: string }> {
  return fetchJson('/api/workspace/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId }),
  });
}

export async function inviteWorkspaceMember(body: { username: string; role: string }): Promise<{ status: string }> {
  return fetchJson('/api/workspace/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function removeWorkspaceMember(userId: number): Promise<void> {
  return fetchOk(`/api/workspace/members/${userId}`, { method: 'DELETE' });
}

export async function adminMe(): Promise<AdminMe> {
  return fetchJson<AdminMe>('/api/me');
}

export type UpdateProfileBody = {
  username?: string;
  email?: string;
  password?: string;
  current_password?: string;
};

export type UpdateProfileResponse = AdminMe & {
  status: string;
  password_changed?: boolean;
};

export async function updateAdminProfile(body: UpdateProfileBody): Promise<UpdateProfileResponse> {
  return fetchJson<UpdateProfileResponse>('/api/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function publicFetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(apiUrl(input), {
    ...init,
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const t = await r.text().catch(() => '');
  if (!r.ok) {
    throw parseApiError(r.status, t);
  }
  if (!t) return undefined as T;
  return JSON.parse(t) as T;
}

export type PasswordResetDelivery = 'email' | 'dev_log' | 'none';

export async function requestPasswordReset(body: {
  username: string;
  email: string;
}): Promise<{
  status: string;
  message: string;
  username?: string;
  email_masked?: string;
  delivery?: PasswordResetDelivery;
}> {
  return publicFetchJson('/api/forgot-password', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function verifyResetOtp(body: {
  username: string;
  otp: string;
}): Promise<{ status: string; message: string; username: string; reset_token: string }> {
  return publicFetchJson('/api/verify-reset-otp', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function resetPasswordWithToken(body: {
  reset_token: string;
  password: string;
}): Promise<{ status: string; message: string }> {
  return publicFetchJson('/api/reset-password', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function registerViewer(body: {
  username: string;
  email: string;
  password: string;
}): Promise<AdminMe> {
  const j = await fetchJson<{
    status: string;
    username: string;
    role?: string;
    tenant_id?: number;
    user_id?: number;
    email?: string | null;
  }>('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    username: j.username,
    email: j.email,
    role: j.role,
    tenant_id: j.tenant_id,
    user_id: j.user_id,
  };
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
  return new Headers(base);
}

/** Chỉ dùng cho curl/automation — dashboard dùng cookie session (credentials: include). */
export function adminHeadersWithApiKey(base?: HeadersInit): Headers {
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
    const err = parseApiError(r.status, t, input);
    if (r.status === 401 && shouldForceLogout(input)) {
      forceLogoutOnSessionExpired();
    }
    throw err;
  }
  if (!t) return undefined as T;
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new ApiClientError(r.status, 'invalid_json', `HTTP ${r.status}: body không phải JSON`, undefined, input);
  }
}

export async function fetchOk(input: string, init?: RequestInit): Promise<void> {
  const r = await fetch(apiUrl(input), adminFetchInit(init));
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const err = parseApiError(r.status, t, input);
    if (r.status === 401 && shouldForceLogout(input)) {
      forceLogoutOnSessionExpired();
    }
    throw err;
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
  transform_add_headers?: string;
  transform_remove_headers?: string;
  retry_max?: number;
  retry_on_status?: string;
  /** Backend SQLite/API: 0 | 1 */
  retry_on_timeout?: number;
  queue_on_failure?: boolean;
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
  status: string;
  rate_limit_per_min: number;
  allowed_route_ids: number[];
  last_used_at: string | null;
};

export type RouteAclSummaryRow = {
  route_id: number;
  client_count: number;
  client_names: string[];
};

export type RouteAclClientRow = {
  id: number;
  name: string;
  status: string;
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
  integrationType: string,
  rateLimitPerMin = 0,
  routeIds: number[] = []
): Promise<CreateClientKeyResponse> {
  return fetchJson<CreateClientKeyResponse>('/api/client-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      integration_type: integrationType,
      rate_limit_per_min: rateLimitPerMin,
      route_ids: routeIds,
    }),
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
  email?: string | null;
};

export function fetchAdminUsers(): Promise<AdminUserRow[]> {
  return fetchJson<AdminUserRow[]>('/api/users');
}

export async function createAdminUser(body: {
  username: string;
  password: string;
  role: string;
  email?: string;
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
    email?: string;
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

export type AuditLogsQuery = {
  limit?: number;
  result?: 'all' | 'success' | 'failure';
  search?: string;
};

export function fetchAuditLogs(q?: AuditLogsQuery): Promise<AuditLogRow[]> {
  const params = new URLSearchParams();
  if (q?.limit) params.set('limit', String(q.limit));
  if (q?.result && q.result !== 'all') params.set('result', q.result);
  if (q?.search?.trim()) params.set('search', q.search.trim());
  const qs = params.toString();
  return fetchJson<AuditLogRow[]>(`/api/audit-logs${qs ? `?${qs}` : ''}`);
}

export type TransactionLogRow = {
  id: number;
  tenant_id: number | null;
  request_id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  client_ip: string | null;
  api_key_masked: string | null;
  client_key_id: number | null;
  outcome: string;
  reason: string;
  upstream: string | null;
  created_at: string;
};

export type TransactionLogsQuery = {
  limit?: number;
  method?: string;
  status?: 'all' | '2xx' | '4xx' | '5xx';
  outcome?: 'all' | 'success' | 'failure';
  search?: string;
  reason?: string;
  client_key_id?: number;
};

export type ClientKeyTrafficStats = {
  hours: number;
  total: number;
  success: number;
  denied: number;
  upstream_error: number;
  avg_duration_ms: number;
  top_paths: [string, number][];
};

export function fetchTransactionLogs(q?: TransactionLogsQuery): Promise<TransactionLogRow[]> {
  const params = new URLSearchParams();
  if (q?.limit) params.set('limit', String(q.limit));
  if (q?.method && q.method !== 'all') params.set('method', q.method);
  if (q?.status && q.status !== 'all') params.set('status', q.status);
  if (q?.outcome && q.outcome !== 'all') params.set('outcome', q.outcome);
  if (q?.search?.trim()) params.set('search', q.search.trim());
  if (q?.reason && q.reason !== 'all') params.set('reason', q.reason);
  if (q?.client_key_id) params.set('client_key_id', String(q.client_key_id));
  const qs = params.toString();
  return fetchJson<TransactionLogRow[]>(`/api/transaction-logs${qs ? `?${qs}` : ''}`);
}

export type GatewaySettings = {
  rate_limit_enabled: boolean;
  rate_limit_rps: number;
  rate_limit_burst: number;
  enable_metrics: boolean;
  enable_health_check: boolean;
  transform_enabled: boolean;
  retry_enabled: boolean;
  queue_enabled: boolean;
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
  transform_enabled?: boolean;
  retry_enabled?: boolean;
  queue_enabled?: boolean;
};

export type DlqItemStatus = 'pending' | 'replayed' | 'failed_permanent';

export type ProxyQueueItem = {
  id: string;
  tenant_id: number;
  route_id: number;
  method: string;
  path: string;
  upstream_url: string;
  failure_reason: string;
  retry_attempts: number;
  created_at_unix: number;
  /** Backend `GET /api/proxy-queue` luôn trả — thiếu thì coi pending. */
  status: DlqItemStatus;
  replayed_at?: string | null;
};

/** Chuẩn hóa status DLQ khi response cũ/thiếu field. */
export function normalizeDlqStatus(status: string | undefined | null): DlqItemStatus {
  if (status === 'replayed' || status === 'failed_permanent') return status;
  return 'pending';
}

export function countDlqByStatus(items: ReadonlyArray<{ status?: string | null }>) {
  let pending = 0;
  let replayed = 0;
  let failedPermanent = 0;
  for (const item of items) {
    const s = normalizeDlqStatus(item.status);
    if (s === 'replayed') replayed += 1;
    else if (s === 'failed_permanent') failedPermanent += 1;
    else pending += 1;
  }
  return { pending, replayed, failedPermanent, total: items.length };
}

export function fetchProxyQueue(): Promise<ProxyQueueItem[]> {
  return fetchJson<ProxyQueueItem[]>('/api/proxy-queue');
}

export function retryProxyQueueItem(id: string): Promise<{
  status: string;
  upstream_status: number;
  body_preview: string;
}> {
  return fetchJson(`/api/proxy-queue/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}

export function deleteProxyQueueItem(id: string): Promise<void> {
  return fetchOk(`/api/proxy-queue/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function bulkDeleteProxyQueueItems(ids: string[]): Promise<{ deleted: number }> {
  return fetchJson<{ deleted: number }>('/api/proxy-queue/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

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
  is_demo?: boolean;
};

export function fetchIntegrations(): Promise<IntegrationRow[]> {
  return fetchJson<IntegrationRow[]>('/api/integrations');
}

export type BridgeFieldMapping = {
  id: string;
  source_entity: string;
  source_field: string;
  target_entity: string;
  target_field: string;
  enabled: boolean;
  label: string;
};

export type IntegrationBridgeConfig = {
  enabled: boolean;
  direction: string;
  mappings: BridgeFieldMapping[];
  both_connected: boolean;
};

export function fetchIntegrationBridge(): Promise<IntegrationBridgeConfig> {
  return fetchJson<IntegrationBridgeConfig>('/api/integrations/bridge');
}

export function updateIntegrationBridge(body: {
  enabled: boolean;
  direction: string;
  mappings: BridgeFieldMapping[];
}): Promise<IntegrationBridgeConfig> {
  return fetchJson<IntegrationBridgeConfig>('/api/integrations/bridge', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function runIntegrationBridge(): Promise<{
  status: string;
  provider: string;
  entity_type: string;
  records: number;
  mappings_enabled: number;
}> {
  return fetchJson('/api/integrations/bridge/run', { method: 'POST' });
}

export type SyncLogRow = {
  id: number;
  tenant_id: number;
  status: string;
  message: string;
  error_detail: string | null;
  created_at: string;
};

export function fetchSyncLogs(): Promise<SyncLogRow[]> {
  return fetchJson<SyncLogRow[]>('/api/integrations/sync-logs');
}

export type SyncNowResult = {
  status: string;
  salesforce: {
    provider: string;
    opportunity: number;
    account: number;
    contact?: number;
    demo?: boolean;
  };
  bridge: IntegrationBridgeRunResult;
  push: {
    status?: string;
    created?: number;
    skipped?: number;
    tasks_created?: number;
    documents_created?: number;
    office_integrator?: boolean;
    demo?: boolean;
    reason?: string;
    message?: string;
  };
};

export type EntityLinkRow = {
  sf_entity_type: string;
  sf_id: string;
  zoho_id: string;
  zoho_name: string | null;
  last_synced_at: string;
  document_id: number | null;
  document_filename: string | null;
};

export function fetchEntityLinks(): Promise<EntityLinkRow[]> {
  return fetchJson<EntityLinkRow[]>('/api/integrations/entity-links');
}

export type IntegrationDocumentRow = {
  id: number;
  sf_entity_type: string;
  sf_id: string;
  zoho_project_id: string | null;
  filename: string;
  content_type: string;
  file_size: number;
  source_provider: string;
  created_at: string;
};

export function fetchIntegrationDocuments(): Promise<IntegrationDocumentRow[]> {
  return fetchJson<IntegrationDocumentRow[]>('/api/integrations/documents');
}

export function integrationDocumentDownloadUrl(id: number): string {
  return apiUrl(`/api/integrations/documents/${id}/download`);
}

export type ZohoOfficeConfigPublic = {
  api_domain: string;
  template_path: string;
  enabled: boolean;
  has_api_key: boolean;
  api_key_masked?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
};

export function fetchOfficeConfig(): Promise<ZohoOfficeConfigPublic> {
  return fetchJson<ZohoOfficeConfigPublic>('/api/integrations/office/config');
}

export function updateOfficeConfig(body: {
  api_key: string;
  api_domain: string;
  template_path: string;
  enabled: boolean;
}): Promise<ZohoOfficeConfigPublic> {
  return fetchJson<ZohoOfficeConfigPublic>('/api/integrations/office/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function officeIntegratorTest(): Promise<{
  status: string;
  provider: string;
  template: string;
  pdf_bytes: number;
}> {
  return fetchJson('/api/integrations/office/test');
}

export function integrationSyncNow(): Promise<SyncNowResult> {
  return fetchJson<SyncNowResult>('/api/integrations/sync-now', { method: 'POST' });
}

export function resetIntegrationSync(): Promise<{
  status: string;
  entity_links_deleted: number;
  documents_deleted?: number;
}> {
  return fetchJson('/api/integrations/reset-sync', { method: 'POST' });
}

export function salesforceConnectUrl(): string {
  return apiUrl('/api/integrations/salesforce/connect');
}

export async function salesforceTest(): Promise<{ status: string; limits: unknown }> {
  return fetchJson<{ status: string; limits: unknown }>('/api/integrations/salesforce/test');
}

export type IntegrationBridgeRunResult =
  | { status: 'ok'; provider: string; entity_type: string; records: number; mappings_enabled?: number }
  | { status: 'skipped'; reason: string };

export async function salesforceSync(): Promise<{
  status: string;
  summary: { provider: string; opportunity: number; account: number };
  bridge?: IntegrationBridgeRunResult;
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
  bridge?: IntegrationBridgeRunResult;
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

export type SnapshotContactRow = {
  id: string;
  name?: string;
  email?: string;
  account_id?: string;
  url?: string;
};

export type SnapshotRecordsResponse = {
  provider: string;
  entity_type: string;
  fetched_at: string | null;
  record_count: number;
  records: SnapshotContactRow[];
  hint?: string;
};

export function fetchSnapshotRecords(
  provider = 'salesforce',
  entityType = 'contact',
): Promise<SnapshotRecordsResponse> {
  const q = new URLSearchParams({
    provider,
    entity_type: entityType,
  });
  return fetchJson<SnapshotRecordsResponse>(`/api/integrations/snapshots/records?${q}`);
}

export type DashboardStats = {
  routes_count: number;
  client_keys_count: number;
  client_registry: {
    total: number;
    active: number;
    disabled: number;
  };
  traffic_24h: {
    total: number;
    success: number;
    denied: number;
    upstream_error: number;
    queued: number;
    avg_duration_ms: number;
  };
  traffic_status_buckets: Array<{ label: string; count: number }>;
  traffic_hourly: Array<{ label: string; count: number }>;
  traffic_top_paths: Array<{ label: string; count: number }>;
  traffic_methods: Array<{ label: string; count: number }>;
  traffic_denial_reasons: Array<{ label: string; count: number }>;
  client_traffic_top: Array<{ client_key_id: number; name: string; total: number }>;
  audit_24h: { total: number; success: number; failure: number };
  audit_top_actions: Array<{ label: string; count: number }>;
  audit_hourly: Array<{ label: string; count: number }>;
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

export type MiddlewareStatus = {
  data_plane_prefix: string;
  client_registry: { total: number; active: number; disabled: number };
  routes_count: number;
  oauth_clients_loaded: number;
  rate_limit_global_enabled: boolean;
  rate_limit_global_rps: number;
  integration_platform?: {
    transform_engine: string;
    canonical_entities: string[];
    connectors: string[];
    dlq_storage: string;
    dlq_auto_replay_worker: boolean;
    bridge_enabled: boolean;
  };
};

export type TransformProfile = {
  engine: string;
  entities: string[];
  contact?: {
    canonical: Record<string, string>;
    example?: {
      salesforce_in: Record<string, string>;
      canonical: Record<string, string>;
      zoho_projects_out: Record<string, string>;
    };
  };
};

export type OpportunityTemplateRule = {
  id: string;
  label: string;
  enabled: boolean;
  keywords: string[];
  tasks: string[];
};

export type OpportunityTemplateConfig = {
  enabled: boolean;
  rules: OpportunityTemplateRule[];
  fallback_tasks: string[];
  updated_by?: string | null;
  updated_at?: string | null;
};

export function fetchOpportunityTemplates(): Promise<OpportunityTemplateConfig> {
  return fetchJson<OpportunityTemplateConfig>('/api/integrations/opportunity-templates');
}

export function updateOpportunityTemplates(body: OpportunityTemplateConfig): Promise<OpportunityTemplateConfig> {
  return fetchJson<OpportunityTemplateConfig>('/api/integrations/opportunity-templates', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchTransformProfile(): Promise<TransformProfile> {
  return fetchJson<TransformProfile>('/api/integrations/transform/profile');
}

export function previewTransform(body: {
  provider: string;
  entity: string;
  payload: Record<string, unknown>;
}): Promise<{ canonical: Record<string, unknown> }> {
  return fetchJson('/api/integrations/transform/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function syncContactSfToZoho(body: {
  salesforce_contact_id: string;
  zoho_project_id?: string;
}): Promise<{
  status: string;
  canonical: Record<string, unknown>;
  salesforce: { id: string; raw?: Record<string, unknown> };
  zoho: { project_id: string; request?: Record<string, unknown>; response?: Record<string, unknown> };
}> {
  return fetchJson('/api/integrations/transform/sync-contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchMiddlewareStatus(): Promise<MiddlewareStatus> {
  return fetchJson<MiddlewareStatus>('/api/middleware/status');
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

export async function patchClientKey(
  id: number,
  body: { status?: 'active' | 'disabled'; rate_limit_per_min?: number }
): Promise<void> {
  return fetchOk(`/api/client-keys/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function bulkPatchClientKeyStatus(
  ids: number[],
  status: 'active' | 'disabled',
): Promise<{ updated: number }> {
  return fetchJson<{ updated: number }>('/api/client-keys/bulk-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status }),
  });
}

export async function putClientKeyRoutes(id: number, routeIds: number[]): Promise<{ route_ids: number[] }> {
  return fetchJson<{ route_ids: number[] }>(`/api/client-keys/${id}/routes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ route_ids: routeIds }),
  });
}

export function fetchClientKey(id: number): Promise<ClientKeyMeta> {
  return fetchJson<ClientKeyMeta>(`/api/client-keys/${id}`);
}

export function fetchClientKeyTraffic(
  id: number,
  hours = 24,
): Promise<ClientKeyTrafficStats> {
  return fetchJson<ClientKeyTrafficStats>(`/api/client-keys/${id}/traffic?hours=${hours}`);
}

export type ClientKeyTrafficSummaryRow = {
  client_key_id: number;
  total: number;
};

export function fetchClientKeysTrafficSummary(): Promise<ClientKeyTrafficSummaryRow[]> {
  return fetchJson<ClientKeyTrafficSummaryRow[]>('/api/client-keys/traffic-summary');
}

export function fetchClientKeyRoutes(id: number): Promise<{ route_ids: number[] }> {
  return fetchJson<{ route_ids: number[] }>(`/api/client-keys/${id}/routes`);
}

export function fetchRoutesAclSummary(): Promise<RouteAclSummaryRow[]> {
  return fetchJson<RouteAclSummaryRow[]>('/api/routes/acl-summary');
}

export function fetchRouteClients(routeId: number): Promise<RouteAclClientRow[]> {
  return fetchJson<RouteAclClientRow[]>(`/api/routes/${routeId}/clients`);
}

export type RotateClientKeyResponse = {
  api_key: string;
  secret_key: string;
  auth: string;
};

export function rotateClientKey(id: number): Promise<RotateClientKeyResponse> {
  return fetchJson<RotateClientKeyResponse>(`/api/client-keys/${id}/rotate`, {
    method: 'POST',
  });
}

export type OAuthTokenAuditRow = {
  jti: string;
  subject: string;
  token_type: string;
  grant_type: string;
  scope: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  source_ip: string | null;
  client_key_id: number | null;
  user_id: number | null;
};

export function fetchOAuthTokens(params?: {
  active_only?: boolean;
  limit?: number;
}): Promise<{ tokens: OAuthTokenAuditRow[] }> {
  const q = new URLSearchParams();
  if (params?.active_only !== undefined) q.set('active_only', String(params.active_only));
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  const qs = q.toString();
  return fetchJson<{ tokens: OAuthTokenAuditRow[] }>(
    `/api/oauth/tokens${qs ? `?${qs}` : ''}`,
  );
}

export function revokeOAuthTokenJti(jti: string): Promise<{ status: string; jti: string }> {
  return fetchJson('/api/oauth/tokens/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jti }),
  });
}

export function revokeClientTokens(id: number): Promise<{ status: string; message: string }> {
  return fetchJson(`/api/client-keys/${id}/revoke-tokens`, { method: 'POST' });
}

export type OAuthThirdPartyAppRow = {
  id: number;
  tenant_id: number;
  client_id: string;
  name: string;
  redirect_uris_json: string;
  scopes: string;
  created_at: string;
};

export function fetchOAuthApps(): Promise<{ apps: OAuthThirdPartyAppRow[] }> {
  return fetchJson('/api/oauth/apps');
}

export function createOAuthApp(body: {
  name: string;
  redirect_uris: string[];
  with_secret?: boolean;
}): Promise<{
  client_id: string;
  client_secret: string | null;
  redirect_uris: string[];
  grant_types: string[];
}> {
  return fetchJson('/api/oauth/apps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
