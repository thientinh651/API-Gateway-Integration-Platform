import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { Save, RotateCcw } from 'lucide-react';
import { Switch } from '../components/ui/switch';
import {
  fetchGatewaySettings,
  updateGatewaySettings,
  type GatewaySettings,
} from '../../lib/api';
import { toastApiError } from '../../lib/apiClientError';
import {
  clearOneFieldError,
  failClientValidation,
  fieldInputErrorClass,
  handleFormApiError,
} from '../../lib/formValidation';
import { FieldError } from '../components/forms/FieldError';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { canEditSettings } from '../../lib/rbac';
import { defaultNumberHandlers, parseDefaultNumber } from '../../lib/zeroDefaultNumberInput';

type SettingsForm = {
  rateLimitEnabled: boolean;
  rateLimitRps: string;
  rateLimitBurst: string;
  enableMetrics: boolean;
  enableHealthCheck: boolean;
  transformEnabled: boolean;
  retryEnabled: boolean;
  queueEnabled: boolean;
};

function toForm(data: GatewaySettings): SettingsForm {
  return {
    rateLimitEnabled: data.rate_limit_enabled,
    rateLimitRps: String(data.rate_limit_rps),
    rateLimitBurst: String(data.rate_limit_burst),
    enableMetrics: data.enable_metrics,
    enableHealthCheck: data.enable_health_check,
    transformEnabled: data.transform_enabled ?? false,
    retryEnabled: data.retry_enabled ?? false,
    queueEnabled: data.queue_enabled ?? false,
  };
}

export function Settings() {
  const { user } = useAdminAuth();
  const allowEdit = canEditSettings(user);
  const readOnly = !allowEdit;
  const [settings, setSettings] = useState<SettingsForm | null>(null);
  const [snapshot, setSnapshot] = useState<GatewaySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchGatewaySettings();
      setSettings(toForm(data));
      setSnapshot(data);
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveSettings = async () => {
    if (!settings || !snapshot) return;
    const rpsDefault = String(snapshot.rate_limit_rps);
    const burstDefault = String(snapshot.rate_limit_burst);
    const rateLimitRps = Number(parseDefaultNumber(settings.rateLimitRps, rpsDefault));
    const rateLimitBurst = Number(parseDefaultNumber(settings.rateLimitBurst, burstDefault));
    const clientErrors: Record<string, string> = {};
    if (!Number.isFinite(rateLimitRps)) {
      clientErrors.rate_limit_rps = 'Nhập số hợp lệ';
    }
    if (!Number.isFinite(rateLimitBurst)) {
      clientErrors.rate_limit_burst = 'Nhập số hợp lệ';
    }
    if (Object.keys(clientErrors).length > 0) {
      failClientValidation(setFieldErrors, clientErrors);
      return;
    }

    setSaving(true);
    setFieldErrors({});
    try {
      const data = await updateGatewaySettings({
        rate_limit_enabled: settings.rateLimitEnabled,
        rate_limit_rps: rateLimitRps,
        rate_limit_burst: rateLimitBurst,
        enable_metrics: settings.enableMetrics,
        enable_health_check: settings.enableHealthCheck,
        transform_enabled: settings.transformEnabled,
        retry_enabled: settings.retryEnabled,
        queue_enabled: settings.queueEnabled,
      });
      setSettings(toForm(data));
      setSnapshot(data);
      toast.success('Đã lưu');
    } catch (e) {
      handleFormApiError(e, setFieldErrors);
    } finally {
      setSaving(false);
    }
  };

  const handleResetSettings = () => {
    if (!snapshot) return;
    setSettings(toForm(snapshot));
    toast.success('Đã reset');
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Cài đặt hệ thống</h1>
        {!allowEdit ? (
          <p className="text-sm text-amber-300 mt-2">Chỉ xem — cần role admin để sửa.</p>
        ) : null}
      </div>

      <div className="max-w-2xl space-y-6">
        {snapshot ? (
          <Card className="rounded-2xl bg-card/80 border-border p-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <span className="text-muted-foreground">Version</span>
              <span className="text-white font-mono text-right">{snapshot.system_info.version}</span>
              <span className="text-muted-foreground">Port</span>
              <span className="text-white font-mono text-right">{snapshot.system_info.bind_port}</span>
              <span className="text-muted-foreground">Database</span>
              <span className="text-white font-mono text-right">{snapshot.system_info.database}</span>
            </div>
          </Card>
        ) : null}

        <Card className="rounded-2xl bg-card/80 border-border p-6">
          <h3 className="text-base font-semibold text-white mb-4">Rate limit</h3>
          {loading || !settings || !snapshot ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-foreground">Global rate limit</Label>
                <Switch
                  checked={settings.rateLimitEnabled}
                  disabled={readOnly}
                  onCheckedChange={(checked) => setSettings({ ...settings, rateLimitEnabled: checked })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-foreground">RPS</Label>
                  <Input
                    value={settings.rateLimitRps}
                    onChange={(e) => {
                      setSettings({ ...settings, rateLimitRps: e.target.value });
                      clearOneFieldError(setFieldErrors, 'rate_limit_rps');
                    }}
                    {...defaultNumberHandlers(
                      settings.rateLimitRps,
                      (v) => setSettings({ ...settings, rateLimitRps: v }),
                      String(snapshot.rate_limit_rps),
                    )}
                    aria-invalid={Boolean(fieldErrors.rate_limit_rps)}
                    className={fieldInputErrorClass(
                      Boolean(fieldErrors.rate_limit_rps),
                      'bg-input border-border text-foreground',
                    )}
                    disabled={readOnly || !settings.rateLimitEnabled}
                  />
                  <FieldError message={fieldErrors.rate_limit_rps} />
                </div>
                <div>
                  <Label className="text-foreground">Burst</Label>
                  <Input
                    value={settings.rateLimitBurst}
                    onChange={(e) => {
                      setSettings({ ...settings, rateLimitBurst: e.target.value });
                      clearOneFieldError(setFieldErrors, 'rate_limit_burst');
                    }}
                    {...defaultNumberHandlers(
                      settings.rateLimitBurst,
                      (v) => setSettings({ ...settings, rateLimitBurst: v }),
                      String(snapshot.rate_limit_burst),
                    )}
                    aria-invalid={Boolean(fieldErrors.rate_limit_burst)}
                    className={fieldInputErrorClass(
                      Boolean(fieldErrors.rate_limit_burst),
                      'bg-input border-border text-foreground',
                    )}
                    disabled={readOnly || !settings.rateLimitEnabled}
                  />
                  <FieldError message={fieldErrors.rate_limit_burst} />
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="rounded-2xl bg-card/80 border-border p-6">
          <h3 className="text-base font-semibold text-white mb-4">Runtime</h3>
          {loading || !settings ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : (
            <div className="space-y-3">
              {(
                [
                  ['Metrics', 'enableMetrics', settings.enableMetrics],
                  ['Health check', 'enableHealthCheck', settings.enableHealthCheck],
                  ['Transform headers', 'transformEnabled', settings.transformEnabled],
                  ['Retry upstream', 'retryEnabled', settings.retryEnabled],
                  ['Dead-letter queue', 'queueEnabled', settings.queueEnabled],
                ] as const
              ).map(([label, key, checked]) => (
                <div key={key} className="flex items-center justify-between">
                  <Label className="text-sm text-foreground">{label}</Label>
                  <Switch
                    checked={checked}
                    disabled={readOnly}
                    onCheckedChange={(c) => setSettings({ ...settings, [key]: c })}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="flex gap-3">
          <Button
            onClick={() => void handleSaveSettings()}
            className="flex-1 bg-primary hover:bg-primary/90"
            disabled={loading || !settings || saving || readOnly}
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Đang lưu…' : 'Lưu'}
          </Button>
          <Button
            onClick={handleResetSettings}
            variant="outline"
            className="flex-1 border-border"
            disabled={loading || !snapshot || saving || readOnly}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>
        </div>
      </div>
    </>
  );
}
