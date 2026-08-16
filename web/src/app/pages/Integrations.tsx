import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { AdminOnly } from '../components/auth/AdminOnly';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import {
  fetchIntegrations,
  salesforceConnectUrl,
  salesforceDisconnect,
  salesforceTest,
  salesforceSync,
  zohoConnectUrl,
  zohoDisconnect,
  zohoTest,
  zohoSync,
  zohoProjects,
  zohoTasks,
  fetchIntegrationSnapshots,
  fetchIntegrationPipelineStatus,
  fetchIntegrationSyncSchedule,
  fetchSyncLogs,
  fetchEntityLinks,
  integrationSyncNow,
  resetIntegrationSync,
  fetchZohoConfig,
  updateZohoConfig,
  fetchSfConfig,
  updateSfConfig,
  type IntegrationRow,
  type IntegrationSnapshotSummary,
  type IntegrationPipelineStatus,
  type IntegrationSyncSchedule,
  type EntityLinkRow,
  type SyncLogRow,
} from '../../lib/api';
import { ApiClientError } from '../../lib/apiClientError';
import { canManageIntegrations } from '../../lib/rbac';
import { formatApiErrorToast, toastApiError } from '../../lib/apiClientError';
import { failClientValidation } from '../../lib/formValidation';
import { describeOAuthRedirectError } from '../../lib/integrationSetup';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  IntegrationConnectorCard,
  IntegrationConnectPrompt,
  INTEGRATION_PROVIDER_META,
  type ProviderKind,
} from './integrations/IntegrationConnectorCard';
import { IntegrationPipelinePanel } from './integrations/IntegrationPipelinePanel';
import { IntegrationAutoSyncPanel } from './integrations/IntegrationAutoSyncPanel';
import { EnterSubmitForm } from '../components/forms/EnterSubmitForm';
import { IntegrationStatusStrip } from './integrations/IntegrationStatusStrip';
import { IntegrationEntityLinksPanel } from './integrations/IntegrationEntityLinksPanel';
import { IntegrationSyncLogsPanel } from './integrations/IntegrationSyncLogsPanel';
import { IntegrationSnapshotsPanel } from './integrations/IntegrationSnapshotsPanel';
import { resolvePipelineSteps } from '../../lib/integrationPipeline';

type FieldErrors = Record<string, string>;
type TabId = 'overview' | 'results' | 'config';

const PROVIDER_META = INTEGRATION_PROVIDER_META;

function FieldHint({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-xs text-red-400 mt-1">{error}</p>;
}

function fieldInputClass(hasError: boolean) {
  return hasError ? 'border-red-500 focus-visible:ring-red-500/50' : '';
}

function validateSfConfig(cfg: {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  login_url: string;
  has_secret: boolean;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!cfg.client_id.trim()) errors.client_id = 'Nhập Consumer Key (Client ID)';
  if (!cfg.client_secret.trim() && !cfg.has_secret) {
    errors.client_secret = 'Nhập Consumer Secret (lần đầu bắt buộc)';
  }
  if (!cfg.login_url.trim()) errors.login_url = 'Nhập Login URL';
  else if (!/^https?:\/\//i.test(cfg.login_url.trim())) {
    errors.login_url = 'Login URL phải bắt đầu bằng http:// hoặc https://';
  }
  if (!cfg.redirect_uri.trim()) errors.redirect_uri = 'Nhập Redirect URI';
  else if (!/^https?:\/\//i.test(cfg.redirect_uri.trim())) {
    errors.redirect_uri = 'Redirect URI phải bắt đầu bằng http:// hoặc https://';
  }
  return errors;
}

function validateZohoConfig(cfg: {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  accounts_url: string;
  scopes: string;
  has_secret: boolean;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!cfg.client_id.trim()) errors.client_id = 'Nhập Client ID';
  if (!cfg.client_secret.trim() && !cfg.has_secret) {
    errors.client_secret = 'Nhập Client Secret (lần đầu bắt buộc)';
  }
  if (!cfg.accounts_url.trim()) errors.accounts_url = 'Nhập Accounts URL';
  else if (!/^https?:\/\//i.test(cfg.accounts_url.trim())) {
    errors.accounts_url = 'Accounts URL phải bắt đầu bằng http:// hoặc https://';
  }
  if (!cfg.redirect_uri.trim()) errors.redirect_uri = 'Nhập Redirect URI';
  else if (!/^https?:\/\//i.test(cfg.redirect_uri.trim())) {
    errors.redirect_uri = 'Redirect URI phải bắt đầu bằng http:// hoặc https://';
  }
  if (!cfg.scopes.trim()) errors.scopes = 'Nhập scopes OAuth';
  return errors;
}

function integrationCallbackUri(path: string): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

function IntegrationsAdmin() {
  const { user } = useAdminAuth();
  const isAdmin = canManageIntegrations(user);
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>('overview');
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState<ProviderKind | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [snapshots, setSnapshots] = useState<IntegrationSnapshotSummary[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLogRow[]>([]);
  const [entityLinks, setEntityLinks] = useState<EntityLinkRow[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<IntegrationPipelineStatus | null>(null);
  const [syncSchedule, setSyncSchedule] = useState<IntegrationSyncSchedule | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [cfgLoading, setCfgLoading] = useState<Partial<Record<ProviderKind, boolean>>>({});
  const [connecting, setConnecting] = useState<Partial<Record<ProviderKind, boolean>>>({});
  const [sfCfg, setSfCfg] = useState({
    client_id: '',
    client_secret: '',
    redirect_uri: integrationCallbackUri('/api/integrations/salesforce/callback'),
    login_url: 'https://login.salesforce.com',
    secret_masked: '',
    has_secret: false,
  });
  const [zohoCfg, setZohoCfg] = useState({
    client_id: '',
    client_secret: '',
    redirect_uri: integrationCallbackUri('/api/integrations/zoho/callback'),
    accounts_url: 'https://accounts.zoho.com',
    scopes:
      'ZohoProjects.portals.READ,ZohoProjects.projects.ALL,ZohoProjects.tasks.READ,ZohoProjects.tasks.CREATE',
    secret_masked: '',
    has_secret: false,
  });
  const [sfCfgErrors, setSfCfgErrors] = useState<FieldErrors>({});
  const [zohoCfgErrors, setZohoCfgErrors] = useState<FieldErrors>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchIntegrations();
      setRows(list);
      if (isAdmin) {
        const [snaps, logs, pipeline, links, schedule] = await Promise.all([
          fetchIntegrationSnapshots(),
          fetchSyncLogs().catch(() => [] as SyncLogRow[]),
          fetchIntegrationPipelineStatus().catch(() => null),
          fetchEntityLinks().catch(() => [] as EntityLinkRow[]),
          fetchIntegrationSyncSchedule().catch(() => null),
        ]);
        setSnapshots(snaps);
        setSyncLogs(logs);
        setPipelineStatus(pipeline);
        setEntityLinks(links);
        setSyncSchedule(schedule);
      }
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  const loadProviderConfig = useCallback(async (kind: ProviderKind) => {
    setCfgLoading((s) => ({ ...s, [kind]: true }));
    try {
      if (kind === 'salesforce') {
        setSfCfgErrors({});
        const cfg = await fetchSfConfig();
        setSfCfg((s) => ({
          ...s,
          client_id: cfg.client_id ?? '',
          client_secret: '',
          redirect_uri: cfg.redirect_uri || s.redirect_uri,
          login_url: cfg.login_url || s.login_url,
          secret_masked: cfg.secret_masked ?? '',
          has_secret: cfg.has_secret ?? false,
        }));
      } else {
        setZohoCfgErrors({});
        const cfg = await fetchZohoConfig();
        setZohoCfg((s) => ({
          ...s,
          client_id: cfg.client_id ?? '',
          client_secret: '',
          redirect_uri: cfg.redirect_uri || s.redirect_uri,
          accounts_url: cfg.accounts_url || s.accounts_url,
          scopes: cfg.scopes || s.scopes,
          secret_masked: cfg.secret_masked ?? '',
          has_secret: cfg.has_secret ?? false,
        }));
      }
    } catch (e) {
      const msg = formatApiErrorToast(e);
      if (kind === 'salesforce') setSfCfgErrors({ _form: msg });
      else setZohoCfgErrors({ _form: msg });
    } finally {
      setCfgLoading((s) => ({ ...s, [kind]: false }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const ok = params.get('ok');
    const err = params.get('error');
    if (ok === 'salesforce') {
      toast.success('Salesforce đã kết nối');
      setWorkspace(null);
      setTab('overview');
      setParams({}, { replace: true });
      void load();
    } else if (ok === 'zoho') {
      toast.success('Zoho Projects đã kết nối');
      setWorkspace(null);
      setTab('overview');
      setParams({}, { replace: true });
      void load();
    } else if (err) {
      const detail = params.get('detail');
      const provider = params.get('provider');
      toast.error(describeOAuthRedirectError(err, detail));
      setTab('config');
      if (provider === 'salesforce' || provider === 'zoho_projects') {
        setWorkspace(provider);
      }
      setParams({}, { replace: true });
      void load();
    }
  }, [params, setParams, load]);

  const openWorkspace = (kind: ProviderKind) => {
    setTab('config');
    setWorkspace(kind);
    void loadProviderConfig(kind);
  };

  const closeWorkspace = () => setWorkspace(null);

  const patchSfCfg = (patch: Partial<typeof sfCfg>, errorKey?: keyof FieldErrors) => {
    setSfCfg((s) => ({ ...s, ...patch }));
    if (errorKey) {
      setSfCfgErrors((prev) => {
        const next = { ...prev };
        delete next[errorKey];
        delete next._form;
        return next;
      });
    }
  };

  const patchZohoCfg = (patch: Partial<typeof zohoCfg>, errorKey?: keyof FieldErrors) => {
    setZohoCfg((s) => ({ ...s, ...patch }));
    if (errorKey) {
      setZohoCfgErrors((prev) => {
        const next = { ...prev };
        delete next[errorKey];
        delete next._form;
        return next;
      });
    }
  };

  const persistSfConfig = async (): Promise<boolean> => {
    const errors = validateSfConfig(sfCfg);
    if (Object.keys(errors).length > 0) {
      failClientValidation(setSfCfgErrors, errors);
      return false;
    }
    setSfCfgErrors({});
    try {
      const res = await updateSfConfig({
        client_id: sfCfg.client_id,
        client_secret: sfCfg.client_secret,
        redirect_uri: sfCfg.redirect_uri,
        login_url: sfCfg.login_url,
      });
      setSfCfg((s) => ({
        ...s,
        client_secret: '',
        secret_masked: res.secret_masked ?? '',
        has_secret: res.has_secret ?? true,
      }));
      return true;
    } catch (e) {
      if (e instanceof ApiClientError && e.fields && Object.keys(e.fields).length > 0) {
        setSfCfgErrors(e.fields);
        toast.error(e.message);
      } else {
        setSfCfgErrors({ _form: formatApiErrorToast(e) });
        toastApiError(e);
      }
      return false;
    }
  };

  const persistZohoConfig = async (): Promise<boolean> => {
    const errors = validateZohoConfig(zohoCfg);
    if (Object.keys(errors).length > 0) {
      failClientValidation(setZohoCfgErrors, errors);
      return false;
    }
    setZohoCfgErrors({});
    try {
      const res = await updateZohoConfig({
        client_id: zohoCfg.client_id,
        client_secret: zohoCfg.client_secret,
        redirect_uri: zohoCfg.redirect_uri,
        accounts_url: zohoCfg.accounts_url,
        scopes: zohoCfg.scopes,
      });
      setZohoCfg((s) => ({
        ...s,
        client_secret: '',
        secret_masked: res.secret_masked ?? '',
        has_secret: res.has_secret ?? true,
      }));
      return true;
    } catch (e) {
      if (e instanceof ApiClientError && e.fields && Object.keys(e.fields).length > 0) {
        setZohoCfgErrors(e.fields);
        toast.error(e.message);
      } else {
        setZohoCfgErrors({ _form: formatApiErrorToast(e) });
        toastApiError(e);
      }
      return false;
    }
  };

  const handleConnect = async (kind: ProviderKind) => {
    setConnecting((s) => ({ ...s, [kind]: true }));
    try {
      const saved =
        kind === 'salesforce' ? await persistSfConfig() : await persistZohoConfig();
      if (!saved) return;
      const url =
        kind === 'salesforce' ? await salesforceConnectUrl() : await zohoConnectUrl();
      window.location.href = url.url;
    } catch (e) {
      toastApiError(e);
    } finally {
      setConnecting((s) => ({ ...s, [kind]: false }));
    }
  };

  const handleSfSync = async () => {
    setSyncingProvider('salesforce');
    try {
      const res = await salesforceSync();
      toast.success(
        `Pull SF: ${res.summary.account} Account · ${res.summary.opportunity} Opportunity`,
      );
      await load();
    } catch (e) {
      toastApiError(e);
    } finally {
      setSyncingProvider(null);
    }
  };

  const handleZohoSync = async () => {
    setSyncingProvider('zoho_projects');
    try {
      const res = await zohoSync();
      toast.success(`Pull Zoho: ${res.summary.project} Project · ${res.summary.task} Task`);
      await load();
    } catch (e) {
      toastApiError(e);
    } finally {
      setSyncingProvider(null);
    }
  };

  const handleSyncNow = async () => {
    setSyncingNow(true);
    try {
      const res = await integrationSyncNow();
      if (res.pipeline) setPipelineStatus(res.pipeline);
      const delivery = res.delivery as
        | { updated?: number; invoices?: { created?: number } }
        | undefined;
      const push = res.push as { created?: number; skipped?: number } | undefined;
      const opp = (res.opportunity as { count?: number } | undefined)?.count;
      if (!res.zoho_connected) {
        toast.message('Đã sync Salesforce — kết nối Zoho Projects để đẩy dự án');
      } else {
        const created = push?.created ?? 0;
        const skipped = push?.skipped ?? 0;
        const completed = delivery?.updated ?? 0;
        const inv = delivery?.invoices?.created ?? 0;
        toast.success(
          `Sync xong: SF→Zoho: ${opp ?? '—'} Opportunity · tạo ${created} dự án (${skipped} bỏ qua) · Zoho→SF: ${completed} hoàn thành · ${inv} hóa đơn`,
        );
      }
      await load();
      setTab('results');
    } catch (e) {
      toastApiError(e);
    } finally {
      setSyncingNow(false);
    }
  };

  const handleSfTest = async () => {
    setTestingProvider('salesforce');
    setTestResult(null);
    try {
      const res = await salesforceTest();
      setTestResult(JSON.stringify(res, null, 2));
      toast.success('Gọi Salesforce API limits thành công');
    } catch (e) {
      toastApiError(e);
    } finally {
      setTestingProvider(null);
    }
  };

  const handleZohoTest = async () => {
    setTestingProvider('zoho_projects');
    setTestResult(null);
    try {
      const res = await zohoTest();
      setTestResult(JSON.stringify(res, null, 2));
      if (!res.portal_id && (res.portals_count ?? 0) === 0) {
        toast.warning('Zoho OK nhưng chưa thấy portal.');
      } else {
        toast.success(res.portal_id ? 'Zoho OK — đã thấy portal' : 'Zoho portals OK');
      }
    } catch (e) {
      toastApiError(e);
    } finally {
      setTestingProvider(null);
    }
  };

  const handleZohoProjects = async () => {
    setTestingProvider('zoho_projects');
    setTestResult(null);
    try {
      const res = await zohoProjects();
      setTestResult(JSON.stringify(res, null, 2));
      toast.success('Zoho projects OK');
    } catch (e) {
      toastApiError(e);
    } finally {
      setTestingProvider(null);
    }
  };

  const handleZohoTasks = async () => {
    setTestingProvider('zoho_projects');
    setTestResult(null);
    try {
      const res = await zohoTasks();
      setTestResult(JSON.stringify(res, null, 2));
      if (!res.project_id) {
        toast.warning('Không có project_id — test projects trước.');
      } else {
        toast.success('Zoho tasks OK');
      }
    } catch (e) {
      toastApiError(e);
    } finally {
      setTestingProvider(null);
    }
  };

  const handleDisconnect = async (kind: ProviderKind) => {
    try {
      if (kind === 'salesforce') await salesforceDisconnect();
      else await zohoDisconnect();
      toast.success(`Đã ngắt kết nối ${PROVIDER_META[kind].label}`);
      setWorkspace(null);
      await load();
    } catch (e) {
      toastApiError(e);
    }
  };

  const handleResetSync = async () => {
    try {
      const res = await resetIntegrationSync();
      toast.success(`Đã xóa ${res.entity_links_deleted} link đồng bộ cũ — Đồng bộ ngay lại`);
      await load();
    } catch (e) {
      toastApiError(e);
    }
  };

  const sf = rows.find((r) => r.provider === 'salesforce');
  const zoho = rows.find((r) => r.provider === 'zoho_projects');
  const sfConnected = sf?.status === 'connected';
  const zohoConnected = zoho?.status === 'connected';
  const inDemoMode = Boolean(sf?.is_demo || zoho?.is_demo);
  const showPipeline = sfConnected;

  const pipelineSteps = useMemo(
    () => resolvePipelineSteps(pipelineStatus, snapshots, syncLogs, sfConnected, zohoConnected),
    [pipelineStatus, snapshots, syncLogs, sfConnected, zohoConnected],
  );

  const scrollToSyncLogs = () => {
    setTab('results');
    requestAnimationFrame(() => {
      document.getElementById('section-sync-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const renderSfConfigForm = () => (
    <div className="space-y-3">
      <div>
        <Label className="text-slate-300">Consumer Key (Client ID)</Label>
        <Input
          className={`mt-1 bg-slate-950 border-border ${fieldInputClass(Boolean(sfCfgErrors.client_id))}`}
          value={sfCfg.client_id}
          onChange={(e) => patchSfCfg({ client_id: e.target.value }, 'client_id')}
          autoComplete="off"
        />
        <FieldHint error={sfCfgErrors.client_id} />
      </div>
      <div>
        <Label className="text-slate-300">Consumer Secret</Label>
        <Input
          type="password"
          className={`mt-1 bg-slate-950 border-border ${fieldInputClass(Boolean(sfCfgErrors.client_secret))}`}
          value={sfCfg.client_secret}
          placeholder={sfCfg.has_secret ? sfCfg.secret_masked || '••••••••' : 'Nhập secret'}
          onChange={(e) => patchSfCfg({ client_secret: e.target.value }, 'client_secret')}
          autoComplete="new-password"
        />
        <FieldHint error={sfCfgErrors.client_secret} />
      </div>
      <div>
        <Label className="text-slate-300">Login URL</Label>
        <Input
          className={`mt-1 bg-slate-950 border-border ${fieldInputClass(Boolean(sfCfgErrors.login_url))}`}
          value={sfCfg.login_url}
          onChange={(e) => patchSfCfg({ login_url: e.target.value }, 'login_url')}
        />
        <FieldHint error={sfCfgErrors.login_url} />
      </div>
      <div>
        <Label className="text-slate-300">Redirect URI</Label>
        <Input
          className={`mt-1 bg-slate-950 border-border ${fieldInputClass(Boolean(sfCfgErrors.redirect_uri))}`}
          value={sfCfg.redirect_uri}
          onChange={(e) => patchSfCfg({ redirect_uri: e.target.value }, 'redirect_uri')}
        />
        <FieldHint error={sfCfgErrors.redirect_uri} />
      </div>
      <FieldHint error={sfCfgErrors._form} />
    </div>
  );

  const renderZohoConfigForm = () => (
    <div className="space-y-3">
      <div>
        <Label className="text-slate-300">Client ID</Label>
        <Input
          className={`mt-1 bg-slate-950 border-border ${fieldInputClass(Boolean(zohoCfgErrors.client_id))}`}
          value={zohoCfg.client_id}
          onChange={(e) => patchZohoCfg({ client_id: e.target.value }, 'client_id')}
          autoComplete="off"
        />
        <FieldHint error={zohoCfgErrors.client_id} />
      </div>
      <div>
        <Label className="text-slate-300">Client Secret</Label>
        <Input
          type="password"
          className={`mt-1 bg-slate-950 border-border ${fieldInputClass(Boolean(zohoCfgErrors.client_secret))}`}
          value={zohoCfg.client_secret}
          placeholder={zohoCfg.has_secret ? zohoCfg.secret_masked || '••••••••' : 'Nhập secret'}
          onChange={(e) => patchZohoCfg({ client_secret: e.target.value }, 'client_secret')}
          autoComplete="new-password"
        />
        <FieldHint error={zohoCfgErrors.client_secret} />
      </div>
      <div>
        <Label className="text-slate-300">Accounts URL</Label>
        <Input
          className={`mt-1 bg-slate-950 border-border ${fieldInputClass(Boolean(zohoCfgErrors.accounts_url))}`}
          value={zohoCfg.accounts_url}
          onChange={(e) => patchZohoCfg({ accounts_url: e.target.value }, 'accounts_url')}
        />
        <FieldHint error={zohoCfgErrors.accounts_url} />
      </div>
      <div>
        <Label className="text-slate-300">Redirect URI</Label>
        <Input
          className={`mt-1 bg-slate-950 border-border ${fieldInputClass(Boolean(zohoCfgErrors.redirect_uri))}`}
          value={zohoCfg.redirect_uri}
          onChange={(e) => patchZohoCfg({ redirect_uri: e.target.value }, 'redirect_uri')}
        />
        <FieldHint error={zohoCfgErrors.redirect_uri} />
      </div>
      <div>
        <Label className="text-slate-300">Scopes</Label>
        <Input
          className={`mt-1 bg-slate-950 border-border ${fieldInputClass(Boolean(zohoCfgErrors.scopes))}`}
          value={zohoCfg.scopes}
          onChange={(e) => patchZohoCfg({ scopes: e.target.value }, 'scopes')}
        />
        <FieldHint error={zohoCfgErrors.scopes} />
      </div>
      <FieldHint error={zohoCfgErrors._form} />
    </div>
  );

  const renderSetupWorkspace = (kind: ProviderKind) => {
    const busy = Boolean(cfgLoading[kind] || connecting[kind]);
    return (
      <Card key={`setup-${kind}`} className="p-6 bg-card/80 border-primary/30 border">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="font-bold text-white">Cấu hình {PROVIDER_META[kind].label}</h3>
            <p className="text-xs text-muted-foreground mt-1">Lưu rồi OAuth qua Connected App / API Console.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={closeWorkspace}>
            Đóng
          </Button>
        </div>
        {cfgLoading[kind] ? (
          <p className="text-sm text-muted-foreground">Đang tải cấu hình…</p>
        ) : (
          <EnterSubmitForm
            className="space-y-4"
            onSubmit={() => void handleConnect(kind)}
            disabled={busy}
          >
            {kind === 'salesforce' ? renderSfConfigForm() : renderZohoConfigForm()}
            <Button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90"
              disabled={busy || !isAdmin}
            >
              {connecting[kind] ? 'Đang chuyển OAuth…' : `Lưu & kết nối ${PROVIDER_META[kind].label}`}
            </Button>
          </EnterSubmitForm>
        )}
      </Card>
    );
  };

  const connectorGrid = (
    <div className="grid md:grid-cols-2 gap-4">
      {sfConnected && sf ? (
        <IntegrationConnectorCard
          kind="salesforce"
          row={sf}
          isAdmin={isAdmin}
          testing={testingProvider === 'salesforce'}
          syncing={syncingProvider === 'salesforce'}
          onDisconnect={() => handleDisconnect('salesforce')}
          onTest={() => void handleSfTest()}
          onSyncSnapshot={() => void handleSfSync()}
          onConfigure={() => openWorkspace('salesforce')}
        />
      ) : (
        <IntegrationConnectPrompt
          kind="salesforce"
          isAdmin={isAdmin}
          onConnect={() => openWorkspace('salesforce')}
        />
      )}

      {zohoConnected && zoho ? (
        <IntegrationConnectorCard
          kind="zoho_projects"
          row={zoho}
          isAdmin={isAdmin}
          testing={testingProvider === 'zoho_projects'}
          syncing={syncingProvider === 'zoho_projects'}
          onDisconnect={() => handleDisconnect('zoho_projects')}
          onTest={() => void handleZohoTest()}
          onTestProjects={() => void handleZohoProjects()}
          onTestTasks={() => void handleZohoTasks()}
          onSyncSnapshot={() => void handleZohoSync()}
          onConfigure={() => openWorkspace('zoho_projects')}
        />
      ) : (
        <IntegrationConnectPrompt
          kind="zoho_projects"
          isAdmin={isAdmin}
          onConnect={() => openWorkspace('zoho_projects')}
        />
      )}
    </div>
  );

  return (
    <>
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Tích hợp</h1>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {isAdmin && showPipeline ? (
            <Button
              className="bg-primary hover:bg-primary/90"
              disabled={syncingNow}
              onClick={() => void handleSyncNow()}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${syncingNow ? 'animate-spin' : ''}`} />
              {syncingNow ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}
            </Button>
          ) : null}
          <Button variant="outline" className="border-border" onClick={() => void load()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Làm mới
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Đang tải…</p>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="space-y-6">
          <TabsList className="bg-slate-900/60 border border-border">
            <TabsTrigger value="overview">Tổng quan</TabsTrigger>
            <TabsTrigger value="results">Kết quả</TabsTrigger>
            <TabsTrigger value="config">Cấu hình</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-0">
            <IntegrationStatusStrip sf={sf} zoho={zoho} />
            {isAdmin && syncSchedule ? (
              <IntegrationAutoSyncPanel schedule={syncSchedule} onUpdated={setSyncSchedule} />
            ) : null}
            {connectorGrid}
          </TabsContent>

          <TabsContent value="results" className="space-y-4 mt-0">
            {!sfConnected ? (
              <p className="text-sm text-muted-foreground">Kết nối Salesforce trước để xem kết quả đồng bộ.</p>
            ) : (
              <>
                <IntegrationEntityLinksPanel links={entityLinks} />
                <div className="grid lg:grid-cols-2 gap-4 items-stretch">
                  <IntegrationSyncLogsPanel logs={syncLogs} />
                  <IntegrationSnapshotsPanel snapshots={snapshots} />
                </div>
                {showPipeline ? (
                  <details className="group rounded-xl border border-border/70 bg-background/30 p-4">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold text-white">Chi tiết pipeline</h3>
                      <span className="shrink-0 text-xs text-primary group-open:hidden">Mở</span>
                      <span className="shrink-0 text-xs text-primary hidden group-open:inline">Ẩn</span>
                    </summary>
                    <div className="mt-4">
                      <IntegrationPipelinePanel steps={pipelineSteps} onScrollLogs={scrollToSyncLogs} />
                    </div>
                  </details>
                ) : null}
              </>
            )}
          </TabsContent>

          <TabsContent value="config" className="space-y-4 mt-0">
            {inDemoMode ? (
              <Card className="p-4 border-amber-500/35 bg-amber-500/10 text-sm">
                <p className="font-medium text-amber-200">Connector đang dùng token demo</p>
                {isAdmin ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 border-amber-500/40 text-amber-100"
                    onClick={() => void handleResetSync()}
                  >
                    Xóa entity links cũ
                  </Button>
                ) : null}
              </Card>
            ) : null}
            {workspace ? renderSetupWorkspace(workspace) : connectorGrid}
            {testResult ? (
              <Card className="p-4 bg-slate-950 border-border border-dashed">
                <h3 className="text-sm font-bold text-white mb-2">Kết quả chẩn đoán</h3>
                <pre className="text-xs text-slate-300 overflow-auto max-h-64">{testResult}</pre>
              </Card>
            ) : null}
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

export function Integrations() {
  return (
    <AdminOnly title="Tích hợp" description="Đăng nhập để quản lý connector Salesforce / Zoho.">
      <IntegrationsAdmin />
    </AdminOnly>
  );
}
