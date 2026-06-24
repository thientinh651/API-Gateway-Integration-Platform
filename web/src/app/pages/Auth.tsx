import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { FlaskConical, Plus, RefreshCw, KeyRound, Zap, AppWindow } from 'lucide-react';
import { AdminOnly } from '../components/auth/AdminOnly';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import {
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: AuthTab =
    tabParam === 'tokens' || tabParam === 'apps' ? tabParam : 'clients';
  const allowCreateKeys = canWriteClientKeys(user);
  const allowDeleteKeys = canDeleteClientKeys(user);
  const canViewTokens = canViewOAuthTokens(user);
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

  const filteredClients = clients.filter((c) => {
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

  const handleDelete = async (id: string) => {
    try {
      await deleteClientKey(Number(id));
      await reload();
      toast.success('Đã xóa client');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
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
          <p className="text-sm text-muted-foreground mt-1">
            Machine clients, audit JWT, app bên thứ 3 (Authorization Code).
          </p>
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
            <Button asChild variant="outline" size="sm" className="border-border">
              <Link to="/proxy-try">
                <FlaskConical className="w-4 h-4 mr-2" />
                Thử
              </Link>
            </Button>
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

          <MiddlewareStatusCard />
          <ClientRegistrySummary clients={clients} />
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Input
                placeholder="Tìm tên, Client ID, loại client…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-input border-border text-sm"
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
              canDelete={allowDeleteKeys}
              canManage={allowCreateKeys}
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
            <OAuthThirdPartyAppsPanel canCreate={canManageApps} />
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
