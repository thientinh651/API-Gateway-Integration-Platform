import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  Plug,
  Plus,
  RefreshCw,
  Unplug,
  FlaskConical,
  Database,
  Cloud,
  X,
} from 'lucide-react';
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
  fetchSyncLogs,
  integrationSyncNow,
  fetchZohoConfig,
  updateZohoConfig,
  fetchSfConfig,
  updateSfConfig,
  type IntegrationRow,
  type IntegrationSnapshotSummary,
  type SyncLogRow,
} from '../../lib/api';
import { ApiClientError } from '../../lib/apiClientError';
import { canManageIntegrations } from '../../lib/rbac';
import { formatApiErrorToast, toastApiError } from '../../lib/apiClientError';
import { failClientValidation } from '../../lib/formValidation';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { ConfirmDangerButton } from '../components/forms/ConfirmDangerButton';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { IntegrationBridge } from './integrations/IntegrationBridge';

type ProviderKind = 'salesforce' | 'zoho_projects';
type FieldErrors = Record<string, string>;

const PROVIDER_META: Record<
  ProviderKind,
  { label: string; short: string; description: string }
> = {
  salesforce: {
    label: 'Salesforce',
    short: 'Salesforce CRM',
    description: 'OAuth Connected App — CRM, SOQL sync',
  },
  zoho_projects: {
    label: 'Zoho Projects',
    short: 'Zoho Projects',
    description: 'OAuth Zoho API Console — Projects & tasks',
  },
};

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

function statusBadge(status: string) {
  switch (status) {
    case 'connected':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'pending':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'error':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    default:
      return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  }
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
  /** Màn thao tác sau khi bấm (+) — null = chỉ hiện dấu cộng trên canvas. */
  const [workspace, setWorkspace] = useState<ProviderKind | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [snapshots, setSnapshots] = useState<IntegrationSnapshotSummary[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLogRow[]>([]);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [cfgLoading, setCfgLoading] = useState<Partial<Record<ProviderKind, boolean>>>({});
  const [cfgSaving, setCfgSaving] = useState<Partial<Record<ProviderKind, boolean>>>({});
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
        const [snaps, logs] = await Promise.all([
          fetchIntegrationSnapshots(),
          fetchSyncLogs().catch(() => [] as SyncLogRow[]),
        ]);
        setSnapshots(snaps);
        setSyncLogs(logs);
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
      setWorkspace('salesforce');
      setParams({}, { replace: true });
      void load();
    } else if (ok === 'zoho') {
      toast.success('Zoho Projects đã kết nối');
      setWorkspace('zoho_projects');
      setParams({}, { replace: true });
      void load();
    } else if (err) {
      toast.error(`OAuth lỗi: ${err}`);
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

  const saveSfConfig = async () => {
    const errors = validateSfConfig(sfCfg);
    if (Object.keys(errors).length > 0) {
      failClientValidation(setSfCfgErrors, errors);
      return;
    }
    setCfgSaving((s) => ({ ...s, salesforce: true }));
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
      toast.success('Đã lưu cấu hình Salesforce');
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && e.fields && Object.keys(e.fields).length > 0) {
        setSfCfgErrors(e.fields);
        toast.error(e.message);
      } else {
        setSfCfgErrors({ _form: formatApiErrorToast(e) });
        toastApiError(e);
      }
    } finally {
      setCfgSaving((s) => ({ ...s, salesforce: false }));
    }
  };

  const saveZohoConfig = async () => {
    const errors = validateZohoConfig(zohoCfg);
    if (Object.keys(errors).length > 0) {
      failClientValidation(setZohoCfgErrors, errors);
      return;
    }
    setCfgSaving((s) => ({ ...s, zoho_projects: true }));
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
      toast.success('Đã lưu cấu hình Zoho');
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && e.fields && Object.keys(e.fields).length > 0) {
        setZohoCfgErrors(e.fields);
        toast.error(e.message);
      } else {
        setZohoCfgErrors({ _form: formatApiErrorToast(e) });
        toastApiError(e);
      }
    } finally {
      setCfgSaving((s) => ({ ...s, zoho_projects: false }));
    }
  };

  const toastBridgeAfterSync = (bridge?: { status: string; records?: number; reason?: string }) => {
    if (!bridge) return;
    if (bridge.status === 'ok' && bridge.records != null) {
      toast.message(`Bridge tự chạy: ${bridge.records} mapped_deals`);
    }
  };

  const handleSfSync = async () => {
    setSyncingProvider('salesforce');
    try {
      const res = await salesforceSync();
      toast.success(
        `Sync SF: ${res.summary.opportunity} opportunities, ${res.summary.account} accounts`
      );
      toastBridgeAfterSync(res.bridge);
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
      toast.success(`Sync Zoho: ${res.summary.project} projects, ${res.summary.task} tasks`);
      toastBridgeAfterSync(res.bridge);
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
      const push = res.push;
      toast.success(
        `Đồng bộ xong: SF ${res.salesforce.account} accounts → Zoho tạo ${push.created} dự án (${push.skipped} bỏ qua)`
      );
      toastBridgeAfterSync(res.bridge);
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
  const showBridge =
    sf?.status === 'connected' && zoho?.status === 'connected';

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
              placeholder={
                sfCfg.has_secret
                  ? `Đã lưu ${sfCfg.secret_masked} — để trống nếu không đổi`
                  : 'Nhập Consumer Secret'
              }
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
          {isAdmin ? (
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={() => void saveSfConfig()}
              disabled={cfgSaving.salesforce}
            >
              {cfgSaving.salesforce ? 'Đang lưu…' : 'Lưu cấu hình'}
            </Button>
          ) : null}
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
              placeholder={
                zohoCfg.has_secret
                  ? `Đã lưu ${zohoCfg.secret_masked} — để trống nếu không đổi`
                  : 'Nhập Client Secret'
              }
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
          {isAdmin ? (
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={() => void saveZohoConfig()}
              disabled={cfgSaving.zoho_projects}
            >
              {cfgSaving.zoho_projects ? 'Đang lưu…' : 'Lưu cấu hình'}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );

  const renderConnectedActions = (kind: ProviderKind, row: IntegrationRow) => (
    <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t border-border">
      <Button
        variant="outline"
        className="border-border"
        disabled={testingProvider === kind}
        onClick={() => void (kind === 'salesforce' ? handleSfTest() : handleZohoTest())}
      >
        <FlaskConical className="w-4 h-4 mr-2" />
        {testingProvider === kind ? 'Đang gọi…' : kind === 'salesforce' ? 'Test API limits' : 'Test portals'}
      </Button>
      {kind === 'zoho_projects' ? (
        <>
          <Button
            variant="outline"
            className="border-border"
            disabled={testingProvider === kind}
            onClick={() => void handleZohoProjects()}
          >
            Test projects
          </Button>
          <Button
            variant="outline"
            className="border-border"
            disabled={testingProvider === kind}
            onClick={() => void handleZohoTasks()}
          >
            Test tasks
          </Button>
        </>
      ) : null}
      {isAdmin ? (
        <>
          <Button
            variant="outline"
            className="border-border"
            disabled={syncingProvider === kind}
            onClick={() => void (kind === 'salesforce' ? handleSfSync() : handleZohoSync())}
          >
            <Database className="w-4 h-4 mr-2" />
            {syncingProvider === kind ? 'Đang sync…' : 'Đồng bộ snapshot'}
          </Button>
          <ConfirmDangerButton
            variant="outline"
            size="default"
            className="border-border text-red-400"
            title={`Ngắt kết nối ${PROVIDER_META[kind].label}?`}
            description="OAuth token sẽ bị xóa — cần kết nối lại để sync/test."
            confirmLabel="Ngắt kết nối"
            pendingLabel="Đang ngắt…"
            onConfirm={() => handleDisconnect(kind)}
          >
            <Unplug className="w-4 h-4 mr-2" />
            Ngắt kết nối
          </ConfirmDangerButton>
        </>
      ) : null}
    </div>
  );

  const renderWorkspace = (kind: ProviderKind) => {
    const meta = PROVIDER_META[kind];
    const row = rows.find((r) => r.provider === kind);
    const status = row?.status ?? 'disconnected';
    const configReady = Boolean(row?.available);
    const connected = status === 'connected';

    return (
      <div className="w-full max-w-xl mx-auto text-left">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <Cloud className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold text-white text-lg">{meta.short}</h2>
                <Badge className={`${statusBadge(status)} border`}>{status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
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

        {row?.last_error ? <p className="text-xs text-amber-400 mb-3">{row.last_error}</p> : null}
        {row?.last_sync_at ? (
          <p className="text-xs text-muted-foreground mb-3">Sync gần nhất: {row.last_sync_at}</p>
        ) : null}

        {connected ? (
          renderConnectedActions(kind, row!)
        ) : isAdmin ? (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              Bước 1: nhập OAuth app → Lưu cấu hình. Bước 2: Kết nối (chỉ hiện sau khi lưu).
            </p>
            {kind === 'salesforce' ? renderSfConfigForm() : renderZohoConfigForm()}
            {configReady ? (
              <div className="mt-6 pt-4 border-t border-dashed border-border">
                <Button
                  className="w-full sm:w-auto bg-primary hover:bg-primary/90"
                  onClick={() => {
                    window.location.href =
                      kind === 'salesforce' ? salesforceConnectUrl() : zohoConnectUrl();
                  }}
                >
                  <Plug className="w-4 h-4 mr-2" />
                  Kết nối {meta.label}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-4">
                Lưu cấu hình xong mới bật nút Kết nối.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Chỉ admin cấu hình và kết nối.</p>
        )}
      </div>
    );
  };

  const statusSummary = [
    sf?.status === 'connected' ? 'Salesforce ✓' : null,
    zoho?.status === 'connected' ? 'Zoho ✓' : null,
  ].filter(Boolean);

  return (
    <>
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Tích hợp</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && showBridge ? (
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

      {loading ? (
        <p className="text-muted-foreground">Đang tải…</p>
      ) : (
        <div className="space-y-6">
          <Card className="p-10 sm:p-14 bg-card/40 border-dashed border-2 border-border flex flex-col items-center justify-center text-center min-h-[280px]">
            {!workspace ? (
              <>
                {statusSummary.length > 0 ? (
                  <p className="text-xs text-emerald-400/90 mb-4">{statusSummary.join(' · ')}</p>
                ) : null}
                {isAdmin ? (
                  <AddIntegrationMenu onPick={openWorkspace} large />
                ) : (
                  <p className="text-sm text-muted-foreground">Chỉ admin thêm tích hợp.</p>
                )}
              </>
            ) : (
              renderWorkspace(workspace)
            )}
          </Card>

          {showBridge && !workspace ? (
            <Card className="p-6 bg-card/80 border-border">
              <IntegrationBridge
                isAdmin={isAdmin}
                sfConnected={sf?.status === 'connected'}
                zohoConnected={zoho?.status === 'connected'}
                onApplied={() => void load()}
              />
            </Card>
          ) : null}
        </div>
      )}

      {testResult ? (
        <Card className="mt-6 p-4 bg-slate-950 border-border">
          <h3 className="text-sm font-bold text-white mb-2">Kết quả test</h3>
          <pre className="text-xs text-slate-300 overflow-auto max-h-64">{testResult}</pre>
        </Card>
      ) : null}

      {!loading && syncLogs.length > 0 ? (
        <Card className="mt-6 p-4 bg-slate-950 border-border">
          <h3 className="text-sm font-bold text-white mb-3">Nhật ký đồng bộ</h3>
          <div className="space-y-2 max-h-64 overflow-auto">
            {syncLogs.map((log) => (
              <div
                key={log.id}
                className="text-xs border border-border rounded p-2 text-slate-300 flex flex-col gap-1"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    className={
                      log.status === 'SUCCESS'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : log.status === 'FAILED'
                          ? 'bg-red-500/10 text-red-400 border-red-500/20'
                          : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    }
                  >
                    {log.status}
                  </Badge>
                  <span className="text-muted-foreground">{log.created_at}</span>
                </div>
                <p className="text-slate-200">{log.message}</p>
                {log.error_detail ? (
                  <p className="text-red-400/90 font-mono break-all">{log.error_detail}</p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {!loading && snapshots.length > 0 ? (
        <Card className="mt-6 p-4 bg-slate-950 border-border">
          <h3 className="text-sm font-bold text-white mb-3">Snapshot báo cáo</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {snapshots.map((s) => (
              <div
                key={`${s.provider}-${s.entity_type}`}
                className="text-xs border border-border rounded p-2 text-slate-300"
              >
                <span className="font-medium text-white">{s.provider}</span> / {s.entity_type}:{' '}
                <strong>{s.record_count}</strong> — {s.fetched_at}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {!loading && (sf?.status === 'connected' || zoho?.status === 'connected') ? (
        <Card className="mt-6 p-4 border-primary/20 bg-primary/5 text-sm text-slate-200">
          <h3 className="font-semibold text-white mb-2">Data plane</h3>
          <ul className="text-xs space-y-1 font-mono">
            <li>
              <code>GET /v1/api/sf/limits</code>
            </li>
            <li>
              <code>GET /v1/api/zoho/api/v3/portals</code>
            </li>
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function AddIntegrationMenu({
  onPick,
  large,
}: {
  onPick: (k: ProviderKind) => void;
  large?: boolean;
}) {
  const kinds: ProviderKind[] = ['salesforce', 'zoho_projects'];
  return (
    <div className={large ? 'flex flex-col sm:flex-row items-center gap-3' : 'flex items-center gap-2'}>
      {kinds.map((k) => (
        <Button
          key={k}
          type="button"
          variant="outline"
          className={
            large
              ? 'h-14 px-6 rounded-xl border-dashed border-2 border-primary/40 hover:border-primary hover:bg-primary/10 text-primary font-semibold gap-2'
              : 'border-dashed border-border gap-1 text-xs'
          }
          onClick={() => onPick(k)}
        >
          <Plus className={large ? 'w-5 h-5' : 'w-3 h-3'} />
          {PROVIDER_META[k].label}
        </Button>
      ))}
    </div>
  );
}

export function Integrations() {
  return (
    <AdminOnly title="Tích hợp" description="Đăng nhập để quản lý connector Salesforce / Zoho.">
      <IntegrationsAdmin />
    </AdminOnly>
  );
}
