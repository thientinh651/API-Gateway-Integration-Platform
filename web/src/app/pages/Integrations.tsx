import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Plug, RefreshCw, Unplug, FlaskConical, Database } from 'lucide-react';
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
  fetchZohoConfig,
  updateZohoConfig,
  fetchSfConfig,
  updateSfConfig,
  type IntegrationRow,
  type IntegrationSnapshotSummary,
} from '../../lib/api';
import { ApiClientError } from '../../lib/apiClientError';
import { canManageIntegrations } from '../../lib/rbac';
import { formatApiErrorToast, toastApiError } from '../../lib/apiClientError';
import { failClientValidation } from '../../lib/formValidation';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

type FieldErrors = Record<string, string>;

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
  if (!cfg.client_id.trim()) {
    errors.client_id = 'Nhập Consumer Key (Client ID)';
  }
  if (!cfg.client_secret.trim() && !cfg.has_secret) {
    errors.client_secret = 'Nhập Consumer Secret (lần đầu bắt buộc)';
  }
  if (!cfg.login_url.trim()) {
    errors.login_url = 'Nhập Login URL';
  } else if (!/^https?:\/\//i.test(cfg.login_url.trim())) {
    errors.login_url = 'Login URL phải bắt đầu bằng http:// hoặc https://';
  }
  if (!cfg.redirect_uri.trim()) {
    errors.redirect_uri = 'Nhập Redirect URI (Callback URL)';
  } else if (!/^https?:\/\//i.test(cfg.redirect_uri.trim())) {
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
  if (!cfg.client_id.trim()) {
    errors.client_id = 'Nhập Client ID';
  }
  if (!cfg.client_secret.trim() && !cfg.has_secret) {
    errors.client_secret = 'Nhập Client Secret (lần đầu bắt buộc)';
  }
  if (!cfg.accounts_url.trim()) {
    errors.accounts_url = 'Nhập Accounts URL';
  } else if (!/^https?:\/\//i.test(cfg.accounts_url.trim())) {
    errors.accounts_url = 'Accounts URL phải bắt đầu bằng http:// hoặc https://';
  }
  if (!cfg.redirect_uri.trim()) {
    errors.redirect_uri = 'Nhập Redirect URI';
  } else if (!/^https?:\/\//i.test(cfg.redirect_uri.trim())) {
    errors.redirect_uri = 'Redirect URI phải bắt đầu bằng http:// hoặc https://';
  }
  if (!cfg.scopes.trim()) {
    errors.scopes = 'Nhập scopes OAuth';
  }
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
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<IntegrationSnapshotSummary[]>([]);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [zohoCfgOpen, setZohoCfgOpen] = useState(false);
  const [zohoCfgLoading, setZohoCfgLoading] = useState(false);
  const [zohoCfgSaving, setZohoCfgSaving] = useState(false);
  const [zohoCfg, setZohoCfg] = useState({
    client_id: '',
    client_secret: '',
    redirect_uri: integrationCallbackUri('/api/integrations/zoho/callback'),
    accounts_url: 'https://accounts.zoho.com',
    scopes: 'ZohoProjects.portals.READ,ZohoProjects.projects.ALL,ZohoProjects.tasks.READ',
    secret_masked: '',
    has_secret: false,
  });
  const [sfCfgOpen, setSfCfgOpen] = useState(false);
  const [sfCfgLoading, setSfCfgLoading] = useState(false);
  const [sfCfgSaving, setSfCfgSaving] = useState(false);
  const [sfCfg, setSfCfg] = useState({
    client_id: '',
    client_secret: '',
    redirect_uri: integrationCallbackUri('/api/integrations/salesforce/callback'),
    login_url: 'https://login.salesforce.com',
    secret_masked: '',
    has_secret: false,
  });
  const [sfCfgErrors, setSfCfgErrors] = useState<FieldErrors>({});
  const [zohoCfgErrors, setZohoCfgErrors] = useState<FieldErrors>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchIntegrations());
      if (isAdmin) {
        setSnapshots(await fetchIntegrationSnapshots());
      }
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const ok = params.get('ok');
    const err = params.get('error');
    if (ok === 'salesforce') {
      toast.success('Salesforce đã kết nối');
      setParams({}, { replace: true });
      void load();
    } else if (ok === 'zoho') {
      toast.success('Zoho Projects đã kết nối');
      setParams({}, { replace: true });
      void load();
    } else if (err) {
      toast.error(`OAuth lỗi: ${err}`);
      setParams({}, { replace: true });
      void load();
    }
  }, [params, setParams, load]);

  const sf = rows.find((r) => r.provider === 'salesforce');
  const zoho = rows.find((r) => r.provider === 'zoho_projects');

  const handleSfConnect = () => {
    window.location.href = salesforceConnectUrl();
  };

  const handleZohoConnect = () => {
    window.location.href = zohoConnectUrl();
  };

  const openZohoConfig = async () => {
    setZohoCfgOpen(true);
    setZohoCfgLoading(true);
    setZohoCfgErrors({});
    try {
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
    } catch (e) {
      setZohoCfgErrors({ _form: formatApiErrorToast(e) });
    } finally {
      setZohoCfgLoading(false);
    }
  };

  const openSfConfig = async () => {
    setSfCfgOpen(true);
    setSfCfgLoading(true);
    setSfCfgErrors({});
    try {
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
    } catch (e) {
      setSfCfgErrors({ _form: formatApiErrorToast(e) });
    } finally {
      setSfCfgLoading(false);
    }
  };

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
    setSfCfgSaving(true);
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
      toast.success('Đã lưu cấu hình Salesforce (secret mã hóa trong DB)');
      await load();
      setSfCfgOpen(false);
    } catch (e) {
      if (e instanceof ApiClientError && e.fields && Object.keys(e.fields).length > 0) {
        setSfCfgErrors(e.fields);
        toast.error(e.message);
      } else {
        setSfCfgErrors({ _form: formatApiErrorToast(e) });
        toastApiError(e);
      }
    } finally {
      setSfCfgSaving(false);
    }
  };

  const saveZohoConfig = async () => {
    const errors = validateZohoConfig(zohoCfg);
    if (Object.keys(errors).length > 0) {
      failClientValidation(setZohoCfgErrors, errors);
      return;
    }
    setZohoCfgSaving(true);
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
      toast.success('Đã lưu cấu hình Zoho (secret được mã hóa trong DB)');
      await load();
      setZohoCfgOpen(false);
    } catch (e) {
      if (e instanceof ApiClientError && e.fields && Object.keys(e.fields).length > 0) {
        setZohoCfgErrors(e.fields);
        toast.error(e.message);
      } else {
        setZohoCfgErrors({ _form: formatApiErrorToast(e) });
        toastApiError(e);
      }
    } finally {
      setZohoCfgSaving(false);
    }
  };

  const handleSfSync = async () => {
    setSyncingProvider('salesforce');
    try {
      const res = await salesforceSync();
      toast.success(
        `Sync SF: ${res.summary.opportunity} opportunities, ${res.summary.account} accounts`
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
      toast.success(`Sync Zoho: ${res.summary.project} projects, ${res.summary.task} tasks`);
      await load();
    } catch (e) {
      toastApiError(e);
    } finally {
      setSyncingProvider(null);
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
      const empty =
        Array.isArray(res.portals) && res.portals.length === 0;
      if (empty) {
        toast.warning(
          'Zoho OK nhưng chưa thấy portal. Bạn cần tạo/join Zoho Projects portal rồi test lại.'
        );
      } else {
        toast.success(
          res.portal_id
            ? `Zoho OK — portal_id=${res.portal_id}`
            : 'Gọi Zoho Projects portals thành công'
        );
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
        (proj.projects as { projects?: Array<{ id?: string | number }> })
          ?.projects?.[0]?.id ??
        (Array.isArray(proj.projects) ? (proj.projects as Array<{ id?: string | number }>)[0]?.id : null);
      if (!firstId) {
        toast.warning('Không lấy được project_id. Hãy test projects trước và đảm bảo có ít nhất 1 project.');
        setTestResult(JSON.stringify(proj.projects, null, 2));
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

  const handleSfDisconnect = async () => {
    try {
      await salesforceDisconnect();
      toast.success('Đã ngắt kết nối Salesforce');
      setTestResult(null);
      await load();
    } catch (e) {
      toastApiError(e);
    }
  };

  const handleZohoDisconnect = async () => {
    try {
      await zohoDisconnect();
      toast.success('Đã ngắt kết nối Zoho');
      setTestResult(null);
      await load();
    } catch (e) {
      toastApiError(e);
    }
  };

  const renderConnectorActions = (
    row: IntegrationRow,
    kind: 'salesforce' | 'zoho_projects'
  ) => {
    const onConnect = kind === 'salesforce' ? handleSfConnect : handleZohoConnect;
    const onTest = kind === 'salesforce' ? handleSfTest : handleZohoTest;
    const onDisconnect = kind === 'salesforce' ? handleSfDisconnect : handleZohoDisconnect;
    const configBtn =
      kind === 'salesforce' ? (
        <Button variant="outline" className="border-border" onClick={() => void openSfConfig()}>
          Cấu hình Salesforce
        </Button>
      ) : (
        <Button variant="outline" className="border-border" onClick={() => void openZohoConfig()}>
          Cấu hình Zoho
        </Button>
      );

    if (!isAdmin) {
      return (
        <p className="text-sm text-muted-foreground">Chỉ admin mới kết nối / cấu hình connector.</p>
      );
    }

    if (!row.available) {
      return (
        <>
          {configBtn}
          <p className="text-sm text-muted-foreground w-full">
            Lưu Client ID + Secret qua dialog (mã hóa DB), hoặc env gateway{' '}
            <code>{kind === 'salesforce' ? 'SF_*' : 'ZOHO_*'}</code>.
          </p>
        </>
      );
    }

    if (row.status !== 'connected') {
      return (
        <>
          {configBtn}
          <Button className="bg-primary hover:bg-primary/90" onClick={onConnect}>
            <Plug className="w-4 h-4 mr-2" />
            {kind === 'salesforce' ? 'Kết nối Salesforce' : 'Kết nối Zoho Projects'}
          </Button>
        </>
      );
    }

    return (
      <>
        <Button
          variant="outline"
          className="border-border"
          disabled={testingProvider === kind}
          onClick={() => void onTest()}
        >
          <FlaskConical className="w-4 h-4 mr-2" />
          {testingProvider === kind
            ? 'Đang gọi…'
            : kind === 'salesforce'
              ? 'Test API limits'
              : 'Test portals API'}
        </Button>
        {kind === 'zoho_projects' ? (
          <>
            <Button
              variant="outline"
              className="border-border"
              disabled={testingProvider === kind}
              onClick={() => void handleZohoProjects()}
            >
              <FlaskConical className="w-4 h-4 mr-2" />
              Test projects API
            </Button>
            <Button
              variant="outline"
              className="border-border"
              disabled={testingProvider === kind}
              onClick={() => void handleZohoTasks()}
            >
              <FlaskConical className="w-4 h-4 mr-2" />
              Test tasks (first project)
            </Button>
          </>
        ) : null}
        <Button
          variant="outline"
          className="border-border"
          disabled={syncingProvider === kind}
          onClick={() => void (kind === 'salesforce' ? handleSfSync() : handleZohoSync())}
        >
          <Database className="w-4 h-4 mr-2" />
          {syncingProvider === kind ? 'Đang sync…' : 'Đồng bộ snapshot'}
        </Button>
        <Button
          variant="outline"
          className="border-border text-red-400"
          onClick={() => void onDisconnect()}
        >
          <Unplug className="w-4 h-4 mr-2" />
          Ngắt kết nối
        </Button>
      </>
    );
  };

  return (
    <>
      <div className="mb-8 flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Tích hợp</h1>
          <p className="text-muted-foreground">
            OAuth admin connector — token mã hóa AES trong SQLite (khác API key client).
          </p>
        </div>
        <Button variant="outline" className="border-border" onClick={() => void load()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Làm mới
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Đang tải…</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {rows.map((row) => (
            <Card key={row.provider} className="p-6 bg-card/80 border-border">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Plug className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-bold text-white">{row.label || row.provider}</h2>
                    <p className="text-xs text-muted-foreground font-mono">{row.provider}</p>
                  </div>
                </div>
                <Badge className={`${statusBadge(row.status)} border`}>{row.status}</Badge>
              </div>
              {row.last_error ? (
                <p className="text-xs text-amber-400 mb-4">{row.last_error}</p>
              ) : null}
              {row.last_sync_at ? (
                <p className="text-xs text-muted-foreground mb-3">
                  Lần sync gần nhất: {row.last_sync_at}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {row.provider === 'salesforce' || row.provider === 'zoho_projects'
                  ? renderConnectorActions(
                      row,
                      row.provider as 'salesforce' | 'zoho_projects'
                    )
                  : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {testResult ? (
        <Card className="mt-6 p-4 bg-slate-950 border-border">
          <h3 className="text-sm font-bold text-white mb-2">Kết quả test</h3>
          <pre className="text-xs text-slate-300 overflow-auto max-h-64">{testResult}</pre>
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
                <strong>{s.record_count}</strong> bản ghi — {s.fetched_at}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {!loading && (sf?.status === 'connected' || zoho?.status === 'connected') ? (
        <Card className="mt-6 p-4 border-primary/20 bg-primary/5 text-sm text-slate-200">
          <h3 className="font-semibold text-white mb-2">Data plane — app gọi SF/Zoho qua gateway</h3>
          <p className="mb-2 text-muted-foreground">
            Client dùng API key + HMAC (Auth). Gateway inject OAuth token theo tenant — secret SF/Zoho
            không lộ ra client.
          </p>
          <ul className="text-xs space-y-1 font-mono">
            <li>
              <code>GET /v1/api/sf/limits</code> → Salesforce REST limits
            </li>
            <li>
              <code>GET /v1/api/sf/query?q=SELECT+Id+FROM+Account+LIMIT+5</code>
            </li>
            <li>
              <code>GET /v1/api/zoho/api/v3/portals</code> → Zoho Projects
            </li>
          </ul>
        </Card>
      ) : null}

      {!loading && sf && !sf.available ? (
        <Card className="mt-6 p-4 border-amber-500/20 bg-amber-500/10 text-sm text-amber-100">
          Salesforce: bấm <strong>Cấu hình Salesforce</strong> (Consumer Key/Secret từ Connected App). Callback URL
          phải khớp Redirect URI trong Salesforce (vd{' '}
          <code>https://thientinh.io.vn/api/integrations/salesforce/callback</code>).
        </Card>
      ) : null}

      {!loading && zoho && !zoho.available ? (
        <Card className="mt-6 p-4 border-amber-500/20 bg-amber-500/10 text-sm text-amber-100">
          Zoho: bấm <strong>Cấu hình Zoho</strong> hoặc env gateway. Redirect URI trên Zoho Console phải khớp callback
          (vd <code>https://thientinh.io.vn/api/integrations/zoho/callback</code>).
        </Card>
      ) : null}

      <Dialog
        open={sfCfgOpen}
        onOpenChange={(open) => {
          setSfCfgOpen(open);
          if (!open) setSfCfgErrors({});
        }}
      >
        <DialogTrigger asChild>
          <span />
        </DialogTrigger>
        <DialogContent className="bg-slate-950 border-border">
          <DialogHeader>
            <DialogTitle>Cấu hình Salesforce (mã hóa trong DB)</DialogTitle>
          </DialogHeader>
          {sfCfgLoading ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : (
            <div className="space-y-3">
              {sfCfgErrors._form ? (
                <p className="text-sm text-red-400 border border-red-500/30 rounded p-2">{sfCfgErrors._form}</p>
              ) : null}
              <div>
                <Label>Consumer Key (Client ID)</Label>
                <Input
                  className={fieldInputClass(Boolean(sfCfgErrors.client_id))}
                  value={sfCfg.client_id}
                  onChange={(e) => patchSfCfg({ client_id: e.target.value }, 'client_id')}
                />
                <FieldHint error={sfCfgErrors.client_id} />
              </div>
              <div>
                <Label>Consumer Secret</Label>
                <Input
                  className={fieldInputClass(Boolean(sfCfgErrors.client_secret))}
                  value={sfCfg.client_secret}
                  onChange={(e) => patchSfCfg({ client_secret: e.target.value }, 'client_secret')}
                  placeholder={
                    sfCfg.has_secret && sfCfg.secret_masked
                      ? `Đang lưu: ${sfCfg.secret_masked} — để trống nếu không đổi`
                      : 'Nhập Consumer Secret từ Salesforce'
                  }
                />
                <FieldHint error={sfCfgErrors.client_secret} />
                {sfCfg.has_secret && !sfCfgErrors.client_secret ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    Secret đã lưu DB. Chỉ nhập lại khi đổi secret trên Salesforce.
                  </p>
                ) : null}
              </div>
              <div>
                <Label>Login URL</Label>
                <Input
                  className={fieldInputClass(Boolean(sfCfgErrors.login_url))}
                  value={sfCfg.login_url}
                  onChange={(e) => patchSfCfg({ login_url: e.target.value }, 'login_url')}
                  placeholder="https://login.salesforce.com hoặc https://test.salesforce.com"
                />
                <FieldHint error={sfCfgErrors.login_url} />
              </div>
              <div>
                <Label>Redirect URI (Callback URL)</Label>
                <Input
                  className={fieldInputClass(Boolean(sfCfgErrors.redirect_uri))}
                  value={sfCfg.redirect_uri}
                  onChange={(e) => patchSfCfg({ redirect_uri: e.target.value }, 'redirect_uri')}
                />
                <FieldHint error={sfCfgErrors.redirect_uri} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-border" onClick={() => setSfCfgOpen(false)}>
              Hủy
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={() => void saveSfConfig()}
              disabled={sfCfgSaving}
            >
              {sfCfgSaving ? 'Đang lưu…' : 'Lưu cấu hình'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={zohoCfgOpen}
        onOpenChange={(open) => {
          setZohoCfgOpen(open);
          if (!open) setZohoCfgErrors({});
        }}
      >
        <DialogTrigger asChild>
          <span />
        </DialogTrigger>
        <DialogContent className="bg-slate-950 border-border">
          <DialogHeader>
            <DialogTitle>Cấu hình Zoho Projects (mã hóa trong DB)</DialogTitle>
          </DialogHeader>
          {zohoCfgLoading ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : (
            <div className="space-y-3">
              {zohoCfgErrors._form ? (
                <p className="text-sm text-red-400 border border-red-500/30 rounded p-2">{zohoCfgErrors._form}</p>
              ) : null}
              <div>
                <Label>Client ID</Label>
                <Input
                  className={fieldInputClass(Boolean(zohoCfgErrors.client_id))}
                  value={zohoCfg.client_id}
                  onChange={(e) => patchZohoCfg({ client_id: e.target.value }, 'client_id')}
                />
                <FieldHint error={zohoCfgErrors.client_id} />
              </div>
              <div>
                <Label>Client Secret</Label>
                <Input
                  className={fieldInputClass(Boolean(zohoCfgErrors.client_secret))}
                  value={zohoCfg.client_secret}
                  onChange={(e) => patchZohoCfg({ client_secret: e.target.value }, 'client_secret')}
                  placeholder={
                    zohoCfg.has_secret && zohoCfg.secret_masked
                      ? `Đang lưu: ${zohoCfg.secret_masked} — để trống nếu không đổi`
                      : 'Nhập Client Secret từ Zoho Console'
                  }
                />
                <FieldHint error={zohoCfgErrors.client_secret} />
                {zohoCfg.has_secret && !zohoCfgErrors.client_secret ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    Secret đã lưu DB. Chỉ nhập lại khi đổi secret trên Zoho.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    Secret mã hóa AES-GCM trước khi lưu DB.
                  </p>
                )}
              </div>
              <div>
                <Label>Accounts URL</Label>
                <Input
                  className={fieldInputClass(Boolean(zohoCfgErrors.accounts_url))}
                  value={zohoCfg.accounts_url}
                  onChange={(e) => patchZohoCfg({ accounts_url: e.target.value }, 'accounts_url')}
                />
                <FieldHint error={zohoCfgErrors.accounts_url} />
              </div>
              <div>
                <Label>Redirect URI</Label>
                <Input
                  className={fieldInputClass(Boolean(zohoCfgErrors.redirect_uri))}
                  value={zohoCfg.redirect_uri}
                  onChange={(e) => patchZohoCfg({ redirect_uri: e.target.value }, 'redirect_uri')}
                />
                <FieldHint error={zohoCfgErrors.redirect_uri} />
              </div>
              <div>
                <Label>Scopes</Label>
                <Input
                  className={fieldInputClass(Boolean(zohoCfgErrors.scopes))}
                  value={zohoCfg.scopes}
                  onChange={(e) => patchZohoCfg({ scopes: e.target.value }, 'scopes')}
                />
                <FieldHint error={zohoCfgErrors.scopes} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-border" onClick={() => setZohoCfgOpen(false)}>
              Hủy
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={() => void saveZohoConfig()}
              disabled={zohoCfgSaving}
            >
              {zohoCfgSaving ? 'Đang lưu…' : 'Lưu cấu hình'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
