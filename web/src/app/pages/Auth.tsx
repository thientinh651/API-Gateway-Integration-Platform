import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { FlaskConical, Plus, RefreshCw, KeyRound, Zap, AppWindow, Search } from 'lucide-react';
import { AdminOnly } from '../components/auth/AdminOnly';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { useUndoDelete } from '../../contexts/UndoDeleteContext';
import {
  canAccessClientKeys,
  canDeleteClientKeys,
  canManageOAuthApps,
  canRevokeClientTokens,
  canViewOAuthTokens,
  canWriteClientKeys,
} from '../../lib/rbac';
import {
  ApiClientError,
  bulkPatchClientKeyStatus,
  deleteClientKey,
  fetchClientKeys,
  fetchClientKeysTrafficSummary,
  fetchGatewayRoutes,
  patchClientKey,
  type ClientKeyMeta,
} from '../../lib/api';
import type { GatewayRouteRow } from '../../lib/gatewayRoutes';
import { ClientRegistrySummary } from './auth/ClientRegistrySummary';
import { ClientRegistryTable } from './auth/ClientRegistryTable';
import { ClientKeyConfigSheet } from './auth/ClientKeyConfigSheet';
import { CreateApiKeyDialog } from './auth/CreateApiKeyDialog';
import { MiddlewareStatusCard } from './auth/MiddlewareStatusCard';
import { OAuthTokensPanel } from './auth/OAuthTokensPanel';
import { OAuthThirdPartyAppsPanel } from './auth/OAuthThirdPartyAppsPanel';
import type { ClientRegistryRow } from './auth/clientRegistryTypes';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

type StatusFilter = 'all' | 'active' | 'disabled';
type AuthTab = 'clients' | 'tokens' | 'apps';

function metaToRow(m: ClientKeyMeta): ClientRegistryRow {
  return {
    id: String(m.id),
    name: m.name,
    apiKey: m.api_key ?? '(legacy)',
    authMode: m.auth_mode,
    integrationType: m.integration_type,
    isActive: m.status === 'active',
    rateLimitPerMinute: m.rate_limit_per_min,
    allowedRouteIds: m.allowed_route_ids ?? [],
    lastUsedAt: m.last_used_at ?? null,
  };
}

function AuthAdmin() {
  const { user } = useAdminAuth();
  const { scheduleDelete, scheduleBulkDelete, pendingIdSet, undoSeconds } = useUndoDelete();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const allowCreateKeys = canWriteClientKeys(user);
  const allowDeleteKeys = canDeleteClientKeys(user);
  const allowProxyTry = canAccessClientKeys(user);
  const canViewTokens = canViewOAuthTokens(user);
  const activeTab: AuthTab =
    (tabParam === 'tokens' || tabParam === 'apps') && canViewTokens ? tabParam : 'clients';
  const canRevokeTokens = canRevokeClientTokens(user);
  const canManageApps = canManageOAuthApps(user);
  const [clients, setClients] = useState<ClientRegistryRow[]>([]);
  const [routes, setRoutes] = useState<GatewayRouteRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configClient, setConfigClient] = useState<ClientRegistryRow | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const s = searchParams.get('status');
    if (s === 'active' || s === 'disabled') return s;
    return 'all';
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [createPreset, setCreatePreset] = useState<string | null>(null);
  const [traffic24h, setTraffic24h] = useState<Map<string, number>>(new Map());
  const [middlewareRefreshKey, setMiddlewareRefreshKey] = useState(0);

  const hiddenClientIds = pendingIdSet('client');
  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      if (hiddenClientIds.has(String(c.id))) return false;
      if (statusFilter === 'active' && !c.isActive) return false;
      if (statusFilter === 'disabled' && c.isActive) return false;
      const q = searchTerm.trim().toLowerCase();
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.apiKey.toLowerCase().includes(q) ||
        c.integrationType.toLowerCase().includes(q)
      );
    });
  }, [clients, hiddenClientIds, statusFilter, searchTerm]);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoadError(null);
    try {
      const [list, routeRows, trafficRows] = await Promise.all([
        fetchClientKeys(),
        fetchGatewayRoutes().catch(() => [] as GatewayRouteRow[]),
        fetchClientKeysTrafficSummary().catch(() => []),
      ]);
      setClients(list.map(metaToRow));
      setRoutes(routeRows);
      setTraffic24h(new Map(trafficRows.map((r) => [String(r.client_key_id), r.total])));
      setMiddlewareRefreshKey((k) => k + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      const status = e instanceof ApiClientError ? e.status : 0;
      if (status !== 401) toast.error('Không tải Client Registry');
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId || clients.length === 0) return;
    const row = clients.find((c) => c.id === openId);
    if (!row) return;
    setConfigClient(row);
    setConfigOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [clients, searchParams, setSearchParams]);

  useEffect(() => {
    const create = searchParams.get('create');
    if (!create) return;
    const allowed = ['app', 'partner', 'salesforce', 'zoho', 'test'];
    if (!allowed.includes(create)) return;
    setCreatePreset(create);
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const current = searchParams.get('status');
    const desired = statusFilter === 'all' ? null : statusFilter;
    if (current === desired) return;
    const next = new URLSearchParams(searchParams);
    if (desired) next.set('status', desired);
    else next.delete('status');
    setSearchParams(next, { replace: true });
  }, [statusFilter, searchParams, setSearchParams]);

  const handleDelete = (id: string) => {
    const client = clients.find((c) => c.id === id);
    const label = client ? `client ${client.name}` : `client #${id}`;
    scheduleDelete({
      entity: 'client',
      id,
      label,
      execute: async () => {
        await deleteClientKey(Number(id));
        await reload();
      },
    });
  };

  const openConfig = (client: ClientRegistryRow) => {
    setConfigClient(client);
    setConfigOpen(true);
  };

  const handleBulkStatus = async (ids: string[], status: 'active' | 'disabled') => {
    try {
      const res = await bulkPatchClientKeyStatus(
        ids.map((id) => Number(id)),
        status,
      );
      await reload();
      toast.success(`Đã cập nhật ${res.updated} client → ${status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleToggleStatus = async (id: string, active: boolean) => {
    try {
      await patchClientKey(Number(id), { status: active ? 'active' : 'disabled' });
      setClients((prev) =>
        prev.map((c) => (c.id === id ? { ...c, isActive: active } : c)),
      );
      toast.success(active ? 'Đã bật client' : 'Đã tắt client');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  const handleBulkDelete = (ids: string[]) => {
    scheduleBulkDelete({
      entity: 'client',
      ids,
      label: `${ids.length} client`,
      execute: async () => {
        const results = await Promise.allSettled(ids.map((id) => deleteClientKey(Number(id))));
        const deleted = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.length - deleted;
        await reload();
        if (failed === 0) return;
        if (deleted > 0) {
          throw new Error(`Đã xóa ${deleted} client, ${failed} lỗi`);
        }
        const reason = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
        throw reason?.reason instanceof Error
          ? reason.reason
          : new Error('Không xóa được client');
      },
    });
  };

  const setTab = (tab: AuthTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'clients') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">OAuth & Client Registry</h1>
        </div>
        {activeTab === 'clients' ? (
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="border-border"
              onClick={() => void reload()}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Làm mới
            </Button>
            {allowProxyTry ? (
              <Button asChild variant="outline" size="sm" className="border-border">
                <Link to="/proxy-try">
                  <FlaskConical className="w-4 h-4 mr-2" />
                  Thử
                </Link>
              </Button>
            ) : null}
            {allowCreateKeys ? (
              <CreateApiKeyDialog
                onKeysChanged={() => void reload()}
                presetIntegrationType={createPreset}
                onPresetConsumed={() => setCreatePreset(null)}
              />
            ) : (
              <p className="text-xs text-muted-foreground self-center flex items-center gap-1">
                <Plus className="w-3 h-3" /> Viewer: không đăng ký client
              </p>
            )}
          </div>
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as AuthTab)} className="gap-6">
        <TabsList className="bg-slate-950/80 border border-border flex-wrap h-auto p-1">
          <TabsTrigger value="clients" className="data-[state=active]:text-primary gap-1.5">
            <KeyRound className="w-3.5 h-3.5" />
            Machine clients
          </TabsTrigger>
          {canViewTokens ? (
            <TabsTrigger value="tokens" className="data-[state=active]:text-primary gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Token đang live
            </TabsTrigger>
          ) : null}
          {canViewTokens ? (
            <TabsTrigger value="apps" className="data-[state=active]:text-primary gap-1.5">
              <AppWindow className="w-3.5 h-3.5" />
              App bên thứ 3
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="clients" className="mt-0 space-y-4">
          {loadError ? (
            <div className="mb-4 text-sm text-amber-400 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              {loadError}
            </div>
          ) : null}

          <MiddlewareStatusCard clients={clients} refreshKey={middlewareRefreshKey} />
          <ClientRegistrySummary clients={clients} />
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Tìm tên, Client ID, loại client…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-input border-border text-sm"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-[140px] bg-input border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">Mọi trạng thái</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div id="section-client-registry" className="scroll-mt-24 min-w-0">
            <ClientRegistryTable
              clients={filteredClients}
              routes={routes}
              traffic24h={traffic24h}
              onConfigure={openConfig}
              onDelete={(id) => void handleDelete(id)}
              onBulkStatus={allowCreateKeys ? handleBulkStatus : undefined}
              onStatusChange={allowCreateKeys ? handleToggleStatus : undefined}
              onBulkDelete={allowDeleteKeys ? handleBulkDelete : undefined}
              canDelete={allowDeleteKeys}
              canManage={allowCreateKeys}
              undoSeconds={undoSeconds}
            />
          </div>
        </TabsContent>

        {canViewTokens ? (
          <TabsContent value="tokens" className="mt-0">
            <OAuthTokensPanel canRevoke={canRevokeTokens} />
          </TabsContent>
        ) : null}

        {canViewTokens ? (
          <TabsContent value="apps" className="mt-0">
            <OAuthThirdPartyAppsPanel canManage={canManageApps} />
          </TabsContent>
        ) : null}
      </Tabs>

      <ClientKeyConfigSheet
        client={configClient}
        routes={routes}
        open={configOpen}
        onOpenChange={setConfigOpen}
        onSaved={() => void reload()}
        canManage={allowCreateKeys}
      />
    </>
  );
}

export function Auth() {
  return (
    <AdminOnly
      title="OAuth & Client Registry"
      description="Machine clients, audit JWT live, Authorization Code cho app bên thứ 3."
    >
      <AuthAdmin />
    </AdminOnly>
  );
}
