import { useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { Save, RotateCcw, Server, Database, Shield } from 'lucide-react';
import { Switch } from '../components/ui/switch';

export function Settings() {
  const [adminApiKey, setAdminApiKey] = useState('');
  const [settings, setSettings] = useState({
    serverPort: '8080',
    adminPort: '8081',
    maxConnections: '1000',
    defaultTimeout: '30',
    defaultRateLimit: '100',
    enableMetrics: true,
    enableHealthCheck: true,
    logLevel: 'INFO',
  });

  const handleSaveApiKey = () => {
    if (adminApiKey) {
      localStorage.setItem('admin_api_key', adminApiKey);
      toast.success('Admin API Key đã được lưu');
    } else {
      toast.error('Vui lòng nhập API Key');
    }
  };

  const handleClearApiKey = () => {
    setAdminApiKey('');
    localStorage.removeItem('admin_api_key');
    toast.success('Admin API Key đã được xóa');
  };

  const handleSaveSettings = () => {
    toast.success('Cài đặt hệ thống đã được lưu');
  };

  const handleResetSettings = () => {
    setSettings({
      serverPort: '8080',
      adminPort: '8081',
      maxConnections: '1000',
      defaultTimeout: '30',
      defaultRateLimit: '100',
      enableMetrics: true,
      enableHealthCheck: true,
      logLevel: 'INFO',
    });
    toast.success('Đã reset về cài đặt mặc định');
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Cài đặt hệ thống</h1>
        <p className="text-muted-foreground">
          Cấu hình chung cho Avaso Gateway
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-6">
          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Server className="w-5 h-5 text-blue-500" />
              </div>
              <h3 className="text-lg font-bold text-white">Server Configuration</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-foreground">Data Plane Port</Label>
                <Input
                  value={settings.serverPort}
                  onChange={(e) =>
                    setSettings({ ...settings, serverPort: e.target.value })
                  }
                  className="bg-input border-border text-foreground"
                />
              </div>
              <div>
                <Label className="text-foreground">Admin Plane Port</Label>
                <Input
                  value={settings.adminPort}
                  onChange={(e) =>
                    setSettings({ ...settings, adminPort: e.target.value })
                  }
                  className="bg-input border-border text-foreground"
                />
              </div>
              <div>
                <Label className="text-foreground">Max Connections</Label>
                <Input
                  value={settings.maxConnections}
                  onChange={(e) =>
                    setSettings({ ...settings, maxConnections: e.target.value })
                  }
                  className="bg-input border-border text-foreground"
                />
              </div>
              <div>
                <Label className="text-foreground">Default Timeout (s)</Label>
                <Input
                  value={settings.defaultTimeout}
                  onChange={(e) =>
                    setSettings({ ...settings, defaultTimeout: e.target.value })
                  }
                  className="bg-input border-border text-foreground"
                />
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Shield className="w-5 h-5 text-purple-500" />
              </div>
              <h3 className="text-lg font-bold text-white">Security & Rate Limiting</h3>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-foreground">Default Rate Limit (req/min)</Label>
                <Input
                  value={settings.defaultRateLimit}
                  onChange={(e) =>
                    setSettings({ ...settings, defaultRateLimit: e.target.value })
                  }
                  className="bg-input border-border text-foreground"
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                <div>
                  <p className="text-sm font-medium text-white">Enable Metrics</p>
                  <p className="text-xs text-muted-foreground">
                    Bật endpoint /metrics cho Prometheus
                  </p>
                </div>
                <Switch
                  checked={settings.enableMetrics}
                  onCheckedChange={(checked) =>
                    setSettings({ ...settings, enableMetrics: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                <div>
                  <p className="text-sm font-medium text-white">Enable Health Check</p>
                  <p className="text-xs text-muted-foreground">
                    Bật endpoint /health
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
          </Card>

          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <Database className="w-5 h-5 text-emerald-500" />
              </div>
              <h3 className="text-lg font-bold text-white">Logging</h3>
            </div>
            <div>
              <Label className="text-foreground">Log Level</Label>
              <select
                value={settings.logLevel}
                onChange={(e) =>
                  setSettings({ ...settings, logLevel: e.target.value })
                }
                className="w-full mt-1 px-3 py-2 bg-input border border-border rounded-lg text-foreground"
              >
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>
            </div>
          </Card>

          <div className="flex gap-3">
            <Button
              onClick={handleSaveSettings}
              className="flex-1 bg-primary hover:bg-primary/90"
            >
              <Save className="w-4 h-4 mr-2" />
              Lưu cài đặt
            </Button>
            <Button
              onClick={handleResetSettings}
              variant="outline"
              className="flex-1 border-border"
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
              Dùng để gọi <code className="text-slate-300">/api/routes</code>. Lưu trong{' '}
              <code className="text-slate-300">localStorage</code>.
            </p>
            <div className="space-y-3">
              <div>
                <Label className="text-foreground text-xs uppercase tracking-wider">
                  x-api-key
                </Label>
                <Input
                  value={adminApiKey}
                  onChange={(e) => setAdminApiKey(e.target.value)}
                  placeholder="Paste key here"
                  className="bg-input border-border text-foreground font-mono text-xs"
                />
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={handleSaveApiKey}
                  className="flex-1 bg-primary hover:bg-primary/90"
                >
                  Save
                </Button>
                <Button
                  onClick={handleClearApiKey}
                  variant="outline"
                  className="flex-1 border-border"
                >
                  Clear
                </Button>
              </div>
              {adminApiKey && (
                <div className="mt-4 text-xs text-emerald-400">
                  ✓ Key đã được lưu trong localStorage
                </div>
              )}
            </div>
          </Card>

          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6 mt-6">
            <h3 className="text-lg font-bold text-white mb-4">System Info</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="text-white font-mono">v1.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Runtime</span>
                <span className="text-white font-mono">Rust/Tokio</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Database</span>
                <span className="text-white font-mono">SQLite</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Node</span>
                <span className="text-white font-mono">Ubuntu-Avaso-01</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Domain</span>
                <span className="text-white font-mono">thientinh.io.vn</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
