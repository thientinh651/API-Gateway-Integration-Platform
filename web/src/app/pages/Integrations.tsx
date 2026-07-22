import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Cloud, Plug, RefreshCw, X } from 'lucide-react';
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
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** Màn cấu hình khi chưa kết nối — null = không mở form setup. */
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
      setParams({}, { replace: true });
      void load();
    } else if (ok === 'zoho') {
      toast.success('Zoho Projects đã kết nối');
      setWorkspace(null);
      setParams({}, { replace: true });
      void load();
    } else if (err) {
      const detail = params.get('detail');
      const provider = params.get('provider');
      toast.error(describeOAuthRedirectError(err, detail));
      if (provider === 'salesforce' || provider === 'zoho_projects') {
        setWorkspace(provider);
      }
      setParams({}, { replace: true });
      void load();
    }
  }, [params, setParams, load]);

  const openWorkspace = (kind: ProviderKind) => {
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
      const ok =
        kind === 'salesforce' ? await persistSfConfig() : await persistZohoConfig();
      if (!ok) return;
      window.location.href =
        kind === 'salesforce' ? salesforceConnectUrl() : zohoConnectUrl();
    } finally {
      setConnecting((s) => ({ ...s, [kind]: false }));
    }
  };

  const handleSfSync = async () => {
    setSyncingProvider('salesforce');
    try {
      const res = await salesforceSync();
      toast.success(
        `Pull SF: ${res.summary.opportunity} Opportunity · ${res.summary.account} Account`,
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
      if (res.pipeline) {
        setPipelineStatus(res.pipeline);
      }
      const push = res.push;
      if (push?.status === 'skipped' && push?.reason === 'need_both_connected') {
        toast.message('Đã sync Salesforce — kết nối Zoho Projects để đẩy dự án');
      } else {
        const opp = res.salesforce?.opportunity ?? 0;
        const acc = res.salesforce?.account ?? 0;
        toast.success(
          `Sync xong: pull SF ${opp} Opportunity · ${acc} Account → Zoho tạo ${push?.created ?? 0} dự án (${push?.skipped ?? 0} bỏ qua)`,
        );
      }
      await load();
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
      setTestResult(JSON.stringify(res.limits, null, 2));
      toast.success('Gọi Salesforce API limits thành công');
      await load();
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
      setTestResult(JSON.stringify(res.portals, null, 2));
      const empty = Array.isArray(res.portals) && res.portals.length === 0;
      if (empty) {
        toast.warning('Zoho OK nhưng chưa thấy portal.');
      } else {
        toast.success(res.portal_id ? `Zoho OK — portal_id=${res.portal_id}` : 'Zoho portals OK');
      }
      await load();
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
      setTestResult(JSON.stringify(res.projects, null, 2));
      toast.success(`Zoho projects OK — portal_id=${res.portal_id}`);
      await load();
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
      const proj = await zohoProjects();
      const firstId =
        (proj.projects as { projects?: Array<{ id?: string | number }> })?.projects?.[0]?.id ??
        (Array.isArray(proj.projects) ? (proj.projects as Array<{ id?: string | number }>)[0]?.id : null);
      if (!firstId) {
        toast.warning('Không có project_id — test projects trước.');
        return;
      }
      const res = await zohoTasks(String(firstId));
      setTestResult(JSON.stringify(res.tasks, null, 2));
      toast.success(`Zoho tasks OK — project_id=${res.project_id}`);
      await load();
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
      setTestResult(null);
      await load();
    } catch (e) {
      toastApiError(e);
    }
  };

  const sf = rows.find((r) => r.provider === 'salesforce');
  const zoho = rows.find((r) => r.provider === 'zoho_projects');
  const sfConnected = sf?.status === 'connected';
  const zohoConnected = zoho?.status === 'connected';
  const showPipeline = sfConnected;

  const pipelineSteps = useMemo(
    () =>
      resolvePipelineSteps(
        pipelineStatus,
        snapshots,
        syncLogs,
        sfConnected,
        zohoConnected,
      ),
    [pipelineStatus, snapshots, syncLogs, sfConnected, zohoConnected],
  );

  const scrollToSyncLogs = () => {
    document.getElementById('section-sync-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const renderSfConfigForm = () => (
    <div className="space-y-3">
      {sfCfgErrors._form ? (
        <p className="text-sm text-red-400 border border-red-500/30 rounded p-2">{sfCfgErrors._form}</p>
      ) : null}
      {cfgLoading.salesforce ? (
        <p className="text-sm text-muted-foreground">Đang tải cấu hình…</p>
      ) : (
        <>
          <div>
            <Label>Consumer Key (Client ID)</Label>
            <Input
              className={fieldInputClass(Boolean(sfCfgErrors.client_id))}
              value={sfCfg.client_id}
              onChange={(e) => patchSfCfg({ client_id: e.target.value }, 'client_id')}
              disabled={!isAdmin}
            />
            <FieldHint error={sfCfgErrors.client_id} />
          </div>
          <div>
            <Label>Consumer Secret</Label>
            <Input
              type="password"
              autoComplete="off"
              className={fieldInputClass(Boolean(sfCfgErrors.client_secret))}
              value={sfCfg.client_secret}
              onChange={(e) => patchSfCfg({ client_secret: e.target.value }, 'client_secret')}
              placeholder={sfCfg.has_secret ? '' : 'Nhập Consumer Secret'}
              disabled={!isAdmin}
            />
            <FieldHint error={sfCfgErrors.client_secret} />
          </div>
          <div>
            <Label>Login URL</Label>
            <Input
              className={fieldInputClass(Boolean(sfCfgErrors.login_url))}
              value={sfCfg.login_url}
              onChange={(e) => patchSfCfg({ login_url: e.target.value }, 'login_url')}
              disabled={!isAdmin}
            />
            <FieldHint error={sfCfgErrors.login_url} />
          </div>
          <div>
            <Label>Redirect URI (Callback)</Label>
            <Input
              className={fieldInputClass(Boolean(sfCfgErrors.redirect_uri))}
              value={sfCfg.redirect_uri}
              onChange={(e) => patchSfCfg({ redirect_uri: e.target.value }, 'redirect_uri')}
              disabled={!isAdmin}
            />
            <FieldHint error={sfCfgErrors.redirect_uri} />
          </div>
        </>
      )}
    </div>
  );

  const renderZohoConfigForm = () => (
    <div className="space-y-3">
      {zohoCfgErrors._form ? (
        <p className="text-sm text-red-400 border border-red-500/30 rounded p-2">{zohoCfgErrors._form}</p>
      ) : null}
      {cfgLoading.zoho_projects ? (
        <p className="text-sm text-muted-foreground">Đang tải cấu hình…</p>
      ) : (
        <>
          <div>
            <Label>Client ID</Label>
            <Input
              className={fieldInputClass(Boolean(zohoCfgErrors.client_id))}
              value={zohoCfg.client_id}
              onChange={(e) => patchZohoCfg({ client_id: e.target.value }, 'client_id')}
              disabled={!isAdmin}
            />
            <FieldHint error={zohoCfgErrors.client_id} />
          </div>
          <div>
            <Label>Client Secret</Label>
            <Input
              type="password"
              autoComplete="off"
              className={fieldInputClass(Boolean(zohoCfgErrors.client_secret))}
              value={zohoCfg.client_secret}
              onChange={(e) => patchZohoCfg({ client_secret: e.target.value }, 'client_secret')}
              placeholder={zohoCfg.has_secret ? '' : 'Nhập Client Secret'}
              disabled={!isAdmin}
            />
            <FieldHint error={zohoCfgErrors.client_secret} />
          </div>
          <div>
            <Label>Accounts URL</Label>
            <Input
              className={fieldInputClass(Boolean(zohoCfgErrors.accounts_url))}
              value={zohoCfg.accounts_url}
              onChange={(e) => patchZohoCfg({ accounts_url: e.target.value }, 'accounts_url')}
              disabled={!isAdmin}
            />
            <FieldHint error={zohoCfgErrors.accounts_url} />
          </div>
          <div>
            <Label>Redirect URI</Label>
            <Input
              className={fieldInputClass(Boolean(zohoCfgErrors.redirect_uri))}
              value={zohoCfg.redirect_uri}
              onChange={(e) => patchZohoCfg({ redirect_uri: e.target.value }, 'redirect_uri')}
              disabled={!isAdmin}
            />
            <FieldHint error={zohoCfgErrors.redirect_uri} />
          </div>
          <div>
            <Label>Scopes</Label>
            <Input
              className={fieldInputClass(Boolean(zohoCfgErrors.scopes))}
              value={zohoCfg.scopes}
              onChange={(e) => patchZohoCfg({ scopes: e.target.value }, 'scopes')}
              disabled={!isAdmin}
            />
            <FieldHint error={zohoCfgErrors.scopes} />
          </div>
        </>
      )}
    </div>
  );

  const renderSetupWorkspace = (kind: ProviderKind) => {
    const meta = PROVIDER_META[kind];
    const row = rows.find((r) => r.provider === kind);
    if (row?.status === 'connected') return null;

    return (
      <Card key={`setup-${kind}`} className="p-6 bg-card/80 border-primary/30 border">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <Cloud className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-white text-lg">Cấu hình {meta.short}</h2>
              <p className="text-xs text-muted-foreground mt-1">Nhập OAuth app rồi bấm Kết nối</p>
            </div>
          </div>
          <button
            type="button"
            className="p-2 rounded-lg text-muted-foreground hover:text-white hover:bg-slate-800 shrink-0"
            onClick={closeWorkspace}
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isAdmin ? (
          <EnterSubmitForm
            className="space-y-0"
            disabled={connecting[kind]}
            onSubmit={() => void handleConnect(kind)}
          >
            {kind === 'salesforce' ? renderSfConfigForm() : renderZohoConfigForm()}
            <div className="mt-6 pt-4 border-t border-dashed border-border">
              <Button
                type="submit"
                className="w-full sm:w-auto bg-primary hover:bg-primary/90"
                disabled={connecting[kind]}
              >
                <Plug className="w-4 h-4 mr-2" />
                {connecting[kind] ? 'Đang chuyển OAuth…' : `Kết nối ${meta.label}`}
              </Button>
            </div>
          </EnterSubmitForm>
        ) : (
          <p className="text-sm text-muted-foreground">Chỉ admin cấu hình và kết nối.</p>
        )}
      </Card>
    );
  };

  const inDemoMode = Boolean(sf?.is_demo || zoho?.is_demo);

  const handleResetSync = async () => {
    try {
      const res = await resetIntegrationSync();
      toast.success(`Đã xóa ${res.entity_links_deleted} link đồng bộ cũ — Sync Now lại`);
      await load();
    } catch (e) {
      toastApiError(e);
    }
  };

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
              {syncingNow ? 'Đang đồng bộ…' : 'Sync Now'}
            </Button>
          ) : null}
          <Button variant="outline" className="border-border" onClick={() => void load()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Làm mới
          </Button>
        </div>
      </div>

      {!loading && inDemoMode ? (
        <Card className="mb-6 p-4 border-amber-500/35 bg-amber-500/10 text-sm">
          <p className="font-medium text-amber-200">Connector đang dùng token demo</p>
          <p className="text-xs text-amber-200/80 mt-1">
            Kết nối OAuth thật trước khi bảo vệ. Link đồng bộ cũ có thể gây SKIPPED idempotent.
          </p>
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

      {loading ? (
        <p className="text-muted-foreground">Đang tải…</p>
      ) : (
        <div className="space-y-8">
          <IntegrationStatusStrip sf={sf} zoho={zoho} />

          {isAdmin && syncSchedule ? (
            <section className="space-y-3">
              <IntegrationAutoSyncPanel
                schedule={syncSchedule}
                onUpdated={setSyncSchedule}
              />
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Connector OAuth
            </h2>
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
                />
              ) : workspace !== 'salesforce' ? (
                <IntegrationConnectPrompt
                  kind="salesforce"
                  isAdmin={isAdmin}
                  onConnect={() => openWorkspace('salesforce')}
                />
              ) : null}

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
                />
              ) : workspace !== 'zoho_projects' ? (
                <IntegrationConnectPrompt
                  kind="zoho_projects"
                  isAdmin={isAdmin}
                  onConnect={() => openWorkspace('zoho_projects')}
                />
              ) : null}
            </div>

            {workspace ? (
              <div className="md:col-span-2">{renderSetupWorkspace(workspace)}</div>
            ) : null}
          </section>

          {sfConnected ? (
            <section className="space-y-4">
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Kết quả đồng bộ
              </h2>
              <IntegrationEntityLinksPanel links={entityLinks} />
              <div className="grid lg:grid-cols-2 gap-4 items-stretch">
                <IntegrationSyncLogsPanel logs={syncLogs} />
                <IntegrationSnapshotsPanel snapshots={snapshots} />
              </div>

              {showPipeline ? (
                <details className="group rounded-xl border border-border/70 bg-background/30 p-4">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Chi tiết pipeline đồng bộ</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Snapshot SF → lọc Closed Won → push Zoho → ghi Sync Log. Phần này dành cho lúc cần
                        kiểm tra luồng xử lý.
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-primary group-open:hidden">Mở</span>
                    <span className="shrink-0 text-xs text-primary hidden group-open:inline">Ẩn</span>
                  </summary>

                  <div className="mt-4">
                    <IntegrationPipelinePanel steps={pipelineSteps} onScrollLogs={scrollToSyncLogs} />
                  </div>
                </details>
              ) : null}
            </section>
          ) : null}
        </div>
      )}

      {testResult ? (
        <Card className="mt-6 p-4 bg-slate-950 border-border border-dashed">
          <h3 className="text-sm font-bold text-white mb-2">Kết quả chẩn đoán</h3>
          <pre className="text-xs text-slate-300 overflow-auto max-h-64">{testResult}</pre>
        </Card>
      ) : null}
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
