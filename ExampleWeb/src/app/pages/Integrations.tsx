import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Plug, RefreshCw, Unplug, FlaskConical } from 'lucide-react';
import { AdminOnly } from '../components/auth/AdminOnly';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import {
  fetchIntegrations,
  salesforceConnectUrl,
  salesforceDisconnect,
  salesforceTest,
  type IntegrationRow,
} from '../../lib/api';
import { canManageUsers } from '../../lib/rbac';
import { formatApiErrorToast } from '../../lib/apiClientError';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

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

function IntegrationsAdmin() {
  const { user } = useAdminAuth();
  const isAdmin = canManageUsers(user);
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchIntegrations());
    } catch (e) {
      toast.error(formatApiErrorToast(e));
    } finally {
      setLoading(false);
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
      setParams({}, { replace: true });
      void load();
    } else if (err) {
      toast.error(`OAuth lỗi: ${err}`);
      setParams({}, { replace: true });
      void load();
    }
  }, [params, setParams, load]);

  const sf = rows.find((r) => r.provider === 'salesforce');

  const handleConnect = () => {
    window.location.href = salesforceConnectUrl();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await salesforceTest();
      setTestResult(JSON.stringify(res.limits, null, 2));
      toast.success('Gọi Salesforce API limits thành công');
      await load();
    } catch (e) {
      toast.error(formatApiErrorToast(e));
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await salesforceDisconnect();
      toast.success('Đã ngắt kết nối Salesforce');
      setTestResult(null);
      await load();
    } catch (e) {
      toast.error(formatApiErrorToast(e));
    }
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
              {row.provider === 'salesforce' ? (
                <div className="flex flex-wrap gap-2">
                  {isAdmin && row.available ? (
                    <>
                      {row.status !== 'connected' ? (
                        <Button
                          className="bg-primary hover:bg-primary/90"
                          onClick={handleConnect}
                        >
                          <Plug className="w-4 h-4 mr-2" />
                          Kết nối Salesforce
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            className="border-border"
                            disabled={testing}
                            onClick={() => void handleTest()}
                          >
                            <FlaskConical className="w-4 h-4 mr-2" />
                            {testing ? 'Đang gọi…' : 'Test API limits'}
                          </Button>
                          <Button
                            variant="outline"
                            className="border-border text-red-400"
                            onClick={() => void handleDisconnect()}
                          >
                            <Unplug className="w-4 h-4 mr-2" />
                            Ngắt kết nối
                          </Button>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Cấu hình gateway: <code className="text-xs">SF_CLIENT_ID</code>,{' '}
                      <code className="text-xs">SF_CLIENT_SECRET</code>,{' '}
                      <code className="text-xs">SF_REDIRECT_URI</code>
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sắp có — tuần 2 (Zoho Projects OAuth).</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {testResult ? (
        <Card className="mt-6 p-4 bg-slate-950 border-border">
          <h3 className="text-sm font-bold text-white mb-2">Kết quả test (limits)</h3>
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
