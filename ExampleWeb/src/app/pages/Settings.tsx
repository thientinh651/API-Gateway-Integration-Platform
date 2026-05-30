import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { Save, RotateCcw, Server, Database, Shield } from 'lucide-react';
import { Switch } from '../components/ui/switch';
import {
  fetchGatewaySettings,
  updateGatewaySettings,
  type GatewaySettings,
} from '../../lib/api';
import { formatApiErrorToast } from '../../lib/apiClientError';

type SettingsForm = {
  rateLimitEnabled: boolean;
  rateLimitRps: string;
  rateLimitBurst: string;
  enableMetrics: boolean;
  enableHealthCheck: boolean;
};

function toForm(data: GatewaySettings): SettingsForm {
  return {
    rateLimitEnabled: data.rate_limit_enabled,
    rateLimitRps: String(data.rate_limit_rps),
    rateLimitBurst: String(data.rate_limit_burst),
    enableMetrics: data.enable_metrics,
    enableHealthCheck: data.enable_health_check,
  };
}

export function Settings() {
  const [adminApiKey, setAdminApiKey] = useState(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem('admin_api_key') ?? '' : ''
  );
  const [settings, setSettings] = useState<SettingsForm | null>(null);
  const [snapshot, setSnapshot] = useState<GatewaySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchGatewaySettings();
      setSettings(toForm(data));
      setSnapshot(data);
    } catch (e) {
      toast.error(formatApiErrorToast(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveApiKey = () => {
    const key = adminApiKey.trim();
    if (!key) {
      toast.error('Vui lòng nhập API Key');
      return;
    }
    window.localStorage.setItem('admin_api_key', key);
    setAdminApiKey(key);
    toast.success('Admin API Key đã được lưu');
  };

  const handleClearApiKey = () => {
    setAdminApiKey('');
    window.localStorage.removeItem('admin_api_key');
    toast.success('Admin API Key đã được xóa');
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    const rateLimitRps = Number(settings.rateLimitRps);
    const rateLimitBurst = Number(settings.rateLimitBurst);
    if (!Number.isFinite(rateLimitRps) || !Number.isFinite(rateLimitBurst)) {
      toast.error('Nhập số hợp lệ cho RPS và burst');
      return;
    }

    setSaving(true);
    try {
      const data = await updateGatewaySettings({
        rate_limit_enabled: settings.rateLimitEnabled,
        rate_limit_rps: rateLimitRps,
        rate_limit_burst: rateLimitBurst,
        enable_metrics: settings.enableMetrics,
        enable_health_check: settings.enableHealthCheck,
      });
      setSettings(toForm(data));
      setSnapshot(data);
      toast.success('Đã lưu settings runtime');
    } catch (e) {
      toast.error(formatApiErrorToast(e));
    } finally {
      setSaving(false);
    }
  };

  const handleResetSettings = () => {
    if (!snapshot) return;
    setSettings(toForm(snapshot));
    toast.success('Đã khôi phục giá trị đang lưu');
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Cài đặt hệ thống</h1>
        <p className="text-muted-foreground">
          Lưu DB thật. Áp dụng ngay cho global rate limit, <code>/health</code>, <code>/metrics</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-6">
          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Server className="w-5 h-5 text-blue-500" />
              </div>
              <h3 className="text-lg font-bold text-white">Gateway Runtime</h3>
            </div>
            {loading || !snapshot ? (
              <p className="text-sm text-muted-foreground">Đang tải cấu hình runtime...</p>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg bg-background/50 p-3">
                  <p className="text-sm font-medium text-white">Bind Port</p>
                  <p className="text-xs text-muted-foreground">
                    Port process đang listen. Đổi qua biến môi trường <code>PORT</code> rồi restart.
                  </p>
                  <div className="mt-2 text-sm font-mono text-slate-200">{snapshot.system_info.bind_port}</div>
                </div>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                  Port admin riêng, max connections, timeout mặc định, log level live chưa wired vào runtime này.
                </div>
              </div>
            )}
          </Card>

          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Shield className="w-5 h-5 text-purple-500" />
              </div>
              <h3 className="text-lg font-bold text-white">Security & Rate Limiting</h3>
            </div>
            {loading || !settings ? (
              <p className="text-sm text-muted-foreground">Đang tải...</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                  <div>
                    <p className="text-sm font-medium text-white">Global Rate Limit</p>
                    <p className="text-xs text-muted-foreground">
                      Fallback cho route không set <code>rate_limit_per_min</code>.
                    </p>
                  </div>
                  <Switch
                    checked={settings.rateLimitEnabled}
                    onCheckedChange={(checked) => setSettings({ ...settings, rateLimitEnabled: checked })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-foreground">RPS</Label>
                    <Input
                      value={settings.rateLimitRps}
                      onChange={(e) => setSettings({ ...settings, rateLimitRps: e.target.value })}
                      className="bg-input border-border text-foreground"
                      disabled={!settings.rateLimitEnabled}
                    />
                  </div>
                  <div>
                    <Label className="text-foreground">Burst</Label>
                    <Input
                      value={settings.rateLimitBurst}
                      onChange={(e) => setSettings({ ...settings, rateLimitBurst: e.target.value })}
                      className="bg-input border-border text-foreground"
                      disabled={!settings.rateLimitEnabled}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                  <div>
                    <p className="text-sm font-medium text-white">Enable Metrics</p>
                    <p className="text-xs text-muted-foreground">
                      Bật/tắt endpoint <code>/metrics</code>.
                    </p>
                  </div>
                  <Switch
                    checked={settings.enableMetrics}
                    onCheckedChange={(checked) => setSettings({ ...settings, enableMetrics: checked })}
                  />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                  <div>
                    <p className="text-sm font-medium text-white">Enable Health Check</p>
                    <p className="text-xs text-muted-foreground">
                      Bật/tắt endpoint <code>/health</code>.
                    </p>
                  </div>
                  <Switch
                    checked={settings.enableHealthCheck}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, enableHealthCheck: checked })
                    }
                  />
                </div>
              </div>
            )}
          </Card>

          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <Database className="w-5 h-5 text-emerald-500" />
              </div>
              <h3 className="text-lg font-bold text-white">Logging</h3>
            </div>
            <div className="rounded-lg bg-background/50 p-4 text-sm text-muted-foreground">
              Gateway ghi structured JSON bằng <code>tracing</code>. Audit log lưu DB ở trang{' '}
              <span className="text-slate-200">Audit Logs</span>. Transaction log UI thật sẽ nối sau.
            </div>
          </Card>

          <div className="flex gap-3">
            <Button
              onClick={() => void handleSaveSettings()}
              className="flex-1 bg-primary hover:bg-primary/90"
              disabled={loading || !settings || saving}
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
            </Button>
            <Button
              onClick={handleResetSettings}
              variant="outline"
              className="flex-1 border-border"
              disabled={loading || !snapshot || saving}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
          </div>
        </div>

        <div>
          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
            <h3 className="text-lg font-bold text-white mb-4">Admin API Key</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Lưu ở <code className="text-slate-300">localStorage</code>. Client admin sẽ tự gửi header{' '}
              <code className="text-slate-300">x-api-key</code> nếu có.
            </p>
            <div className="space-y-3">
              <div>
                <Label className="text-foreground text-xs uppercase tracking-wider">x-api-key</Label>
                <Input
                  value={adminApiKey}
                  onChange={(e) => setAdminApiKey(e.target.value)}
                  placeholder="Paste key here"
                  className="bg-input border-border text-foreground font-mono text-xs"
                />
              </div>
              <div className="flex gap-3">
                <Button onClick={handleSaveApiKey} className="flex-1 bg-primary hover:bg-primary/90">
                  Save
                </Button>
                <Button onClick={handleClearApiKey} variant="outline" className="flex-1 border-border">
                  Clear
                </Button>
              </div>
              {adminApiKey && <div className="mt-4 text-xs text-emerald-400">Key đã lưu trong localStorage</div>}
            </div>
          </Card>

          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6 mt-6">
            <h3 className="text-lg font-bold text-white mb-4">System Info</h3>
            {snapshot ? (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span className="text-white font-mono">{snapshot.system_info.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Runtime</span>
                  <span className="text-white font-mono">{snapshot.system_info.runtime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Database</span>
                  <span className="text-white font-mono">{snapshot.system_info.database}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bind Port</span>
                  <span className="text-white font-mono">{snapshot.system_info.bind_port}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Log Format</span>
                  <span className="text-white font-mono">{snapshot.system_info.log_format}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Admin API Key Hash</span>
                  <span className="text-white font-mono">
                    {snapshot.system_info.has_admin_api_key ? 'configured' : 'missing'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Chưa tải được thông tin hệ thống.</p>
            )}
          </Card>

          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6 mt-6">
            <h3 className="text-lg font-bold text-white mb-4">Ghi chú</h3>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Route-specific `rate_limit_per_min` vẫn ưu tiên hơn global fallback này.</p>
              <p><code>/metrics</code> và <code>/health</code> sẽ trả 404 khi bạn tắt.</p>
              <p>Port admin riêng, timeout mặc định, max connections, log level live chưa hỗ trợ.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
