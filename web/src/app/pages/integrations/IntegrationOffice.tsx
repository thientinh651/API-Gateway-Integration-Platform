import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FileText, FlaskConical, Link2 } from 'lucide-react';
import {
  fetchEntityLinks,
  fetchIntegrationDocuments,
  fetchOfficeConfig,
  integrationDocumentDownloadUrl,
  officeIntegratorTest,
  updateOfficeConfig,
  type EntityLinkRow,
  type IntegrationDocumentRow,
} from '../../../lib/api';
import { ApiClientError } from '../../../lib/apiClientError';
import { formatApiErrorToast, toastApiError } from '../../../lib/apiClientError';
import { failClientValidation } from '../../../lib/formValidation';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

type FieldErrors = Record<string, string>;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function IntegrationOffice({
  isAdmin,
  sfConnected,
  zohoConnected,
}: {
  isAdmin: boolean;
  sfConnected: boolean;
  zohoConnected: boolean;
}) {
  const [cfg, setCfg] = useState({
    api_key: '',
    api_domain: 'api.office-integrator.com',
    template_path: 'templates/hop-dong-vip.docx',
    enabled: true,
    has_api_key: false,
    api_key_masked: '',
  });
  const [cfgErrors, setCfgErrors] = useState<FieldErrors>({});
  const [cfgLoading, setCfgLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [links, setLinks] = useState<EntityLinkRow[]>([]);
  const [docs, setDocs] = useState<IntegrationDocumentRow[]>([]);

  const load = useCallback(async () => {
    setCfgLoading(true);
    try {
      const [officeCfg, linkRows, docRows] = await Promise.all([
        fetchOfficeConfig(),
        fetchEntityLinks().catch(() => [] as EntityLinkRow[]),
        fetchIntegrationDocuments().catch(() => [] as IntegrationDocumentRow[]),
      ]);
      setCfg((s) => ({
        ...s,
        api_key: '',
        api_domain: officeCfg.api_domain || s.api_domain,
        template_path: officeCfg.template_path || s.template_path,
        enabled: officeCfg.enabled,
        has_api_key: officeCfg.has_api_key,
        api_key_masked: officeCfg.api_key_masked ?? '',
      }));
      setLinks(linkRows);
      setDocs(docRows);
    } catch (e) {
      toastApiError(e);
    } finally {
      setCfgLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveConfig = async () => {
    const errors: FieldErrors = {};
    if (!cfg.api_domain.trim()) errors.api_domain = 'Nhập API domain';
    if (!cfg.template_path.trim()) errors.template_path = 'Nhập đường dẫn template';
    if (!cfg.api_key.trim() && !cfg.has_api_key) {
      errors.api_key = 'Nhập API key (lần đầu bắt buộc)';
    }
    if (Object.keys(errors).length > 0) {
      failClientValidation(setCfgErrors, errors);
      return;
    }
    setCfgErrors({});
    setSaving(true);
    try {
      const res = await updateOfficeConfig({
        api_key: cfg.api_key,
        api_domain: cfg.api_domain,
        template_path: cfg.template_path,
        enabled: cfg.enabled,
      });
      setCfg((s) => ({
        ...s,
        api_key: '',
        has_api_key: res.has_api_key,
        api_key_masked: res.api_key_masked ?? '',
        enabled: res.enabled,
      }));
      toast.success('Đã lưu cấu hình Zoho Office');
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) {
        setCfgErrors(e.fields);
        toast.error(e.message);
      } else {
        toastApiError(e);
      }
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const res = await officeIntegratorTest();
      toast.success(`Merge OK — PDF ${formatBytes(res.pdf_bytes)}`);
    } catch (e) {
      toast.error(formatApiErrorToast(e));
    } finally {
      setTesting(false);
    }
  };

  const pipelineReady = sfConnected && zohoConnected;

  return (
    <div className="space-y-4 scroll-mt-24" id="section-integration-office">
      <Card className="p-6 bg-card/80 border-border">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <h2 className="font-bold text-white text-lg">Zoho Office</h2>
        </div>

        {cfgLoading ? (
          <p className="text-sm text-muted-foreground">Đang tải…</p>
        ) : isAdmin ? (
          <div className="space-y-3">
            {cfgErrors._form ? (
              <p className="text-sm text-red-400 border border-red-500/30 rounded p-2">{cfgErrors._form}</p>
            ) : null}
            <div>
              <Label>API key</Label>
              <Input
                type="password"
                autoComplete="off"
                className={cfgErrors.api_key ? 'border-red-500' : ''}
                value={cfg.api_key}
                onChange={(e) => {
                  setCfg((s) => ({ ...s, api_key: e.target.value }));
                  setCfgErrors((p) => {
                    const n = { ...p };
                    delete n.api_key;
                    return n;
                  });
                }}
                placeholder={cfg.has_api_key ? `Đã lưu (${cfg.api_key_masked})` : 'Từ Zoho Office Integrator'}
                disabled={!isAdmin}
              />
              {cfgErrors.api_key ? (
                <p className="text-xs text-red-400 mt-1">{cfgErrors.api_key}</p>
              ) : null}
            </div>
            <div>
              <Label>API domain</Label>
              <Input
                value={cfg.api_domain}
                onChange={(e) => setCfg((s) => ({ ...s, api_domain: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={cfg.enabled}
                onChange={(e) => setCfg((s) => ({ ...s, enabled: e.target.checked }))}
              />
              Bật tạo PDF khi đồng bộ
            </label>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={() => void saveConfig()} disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
              </Button>
              <Button
                variant="outline"
                className="border-border"
                disabled={testing || !cfg.has_api_key}
                onClick={() => void runTest()}
              >
                <FlaskConical className="w-4 h-4 mr-2" />
                {testing ? 'Đang test merge…' : 'Test merge PDF'}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Chỉ admin cấu hình Office Integrator.</p>
        )}

        {!pipelineReady ? (
          <p className="text-xs text-amber-400/90 mt-4">
            Cần kết nối Salesforce + Zoho Projects trước khi pipeline tạo PDF.
          </p>
        ) : null}
      </Card>

      {links.length > 0 ? (
        <Card className="p-4 bg-slate-950 border-border">
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold text-white">Deal đã đồng bộ (SF ↔ Zoho)</h3>
          </div>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-xs text-left">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-2">SF Opportunity</th>
                  <th className="py-2 pr-2">Zoho Project</th>
                  <th className="py-2 pr-2">PDF</th>
                  <th className="py-2">Sync</th>
                </tr>
              </thead>
              <tbody>
                {links.map((row) => (
                  <tr key={`${row.sf_id}-${row.zoho_id}`} className="border-b border-border/50">
                    <td className="py-2 pr-2 font-mono text-slate-300">{row.sf_id}</td>
                    <td className="py-2 pr-2 text-slate-200">{row.zoho_name ?? row.zoho_id}</td>
                    <td className="py-2 pr-2">
                      {row.document_id ? (
                        <a
                          href={integrationDocumentDownloadUrl(row.document_id)}
                          className="text-primary hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.document_filename ?? 'Tải PDF'}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">{row.last_synced_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {docs.length > 0 ? (
        <Card className="p-4 bg-slate-950 border-border">
          <h3 className="text-sm font-bold text-white mb-3">Hợp đồng đã tạo</h3>
          <div className="space-y-2 max-h-48 overflow-auto">
            {docs.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2 text-xs border border-border rounded p-2"
              >
                <div className="text-slate-300 min-w-0">
                  <span className="font-medium text-white">{d.filename}</span>
                  <span className="text-muted-foreground ml-2">
                    Opp {d.sf_id} · {formatBytes(d.file_size)}
                  </span>
                </div>
                <a
                  href={integrationDocumentDownloadUrl(d.id)}
                  className="text-primary hover:underline shrink-0"
                  target="_blank"
                  rel="noreferrer"
                >
                  Tải
                </a>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
