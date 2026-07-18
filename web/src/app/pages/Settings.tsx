import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Gauge,
  HeartPulse,
  RefreshCw,
  RotateCcw,
  Save,
  Timer,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { TechPageHeader } from '../components/tech/TechPageHeader';
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
import { EnterSubmitForm } from '../components/forms/EnterSubmitForm';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { useUndoDelete } from '../../contexts/UndoDeleteContext';
import { canEditSettings } from '../../lib/rbac';
import { defaultNumberHandlers, parseDefaultNumber } from '../../lib/zeroDefaultNumberInput';

type SettingsForm = {
  rateLimitEnabled: boolean;
  rateLimitBurstEnabled: boolean;
  rateLimitRps: string;
  rateLimitBurst: string;
  enableMetrics: boolean;
  enableHealthCheck: boolean;
  transformEnabled: boolean;
  retryEnabled: boolean;
  queueEnabled: boolean;
  undoDeleteSeconds: string;
};

const RUNTIME_TOGGLES: Array<{
  key: keyof Pick<
    SettingsForm,
    'enableMetrics' | 'enableHealthCheck' | 'transformEnabled' | 'retryEnabled' | 'queueEnabled'
  >;
  label: string;
  description: string;
}> = [
  {
    key: 'enableMetrics',
    label: 'Metrics',
    description: 'Bật /metrics (JSON + Prometheus) cho observability.',
  },
  {
    key: 'enableHealthCheck',
    label: 'Health check',
    description: 'Endpoint /health — ping DB + Redis.',
  },
  {
    key: 'transformEnabled',
    label: 'Transform headers',
    description: 'Thêm/xóa header theo cấu hình route trước upstream.',
  },
  {
    key: 'retryEnabled',
    label: 'Retry upstream',
    description: 'Thử lại khi 502/503/504 hoặc timeout.',
  },
  {
    key: 'queueEnabled',
    label: 'Dead-letter queue',
    description: 'Ghi request thất bại vào DLQ để replay.',
  },
];

function toForm(data: GatewaySettings): SettingsForm {
  return {
    rateLimitEnabled: data.rate_limit_enabled,
    rateLimitBurstEnabled: data.rate_limit_burst_enabled,
    rateLimitRps: String(data.rate_limit_rps),
    rateLimitBurst: String(data.rate_limit_burst),
    enableMetrics: data.enable_metrics,
    enableHealthCheck: data.enable_health_check,
    transformEnabled: data.transform_enabled ?? false,
    retryEnabled: data.retry_enabled ?? false,
    queueEnabled: data.queue_enabled ?? false,
    undoDeleteSeconds: String(data.undo_delete_seconds ?? 10),
  };
}

function SettingToggleRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border/50 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} className="shrink-0 mt-0.5" />
    </div>
  );
}

export function Settings() {
  const { user } = useAdminAuth();
  const { refreshUndoSeconds } = useUndoDelete();
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

  const isDirty = useMemo(() => {
    if (!settings || !snapshot) return false;
    return JSON.stringify(settings) !== JSON.stringify(toForm(snapshot));
  }, [settings, snapshot]);

  const handleSaveSettings = async () => {
    if (!settings || !snapshot) return;
    const rpsDefault = String(snapshot.rate_limit_rps);
    const burstDefault = String(snapshot.rate_limit_burst);
    const undoDefault = String(snapshot.undo_delete_seconds ?? 10);
    const rateLimitRps = Number(parseDefaultNumber(settings.rateLimitRps, rpsDefault));
    const rateLimitBurst = Number(parseDefaultNumber(settings.rateLimitBurst, burstDefault));
    const undoDeleteSeconds = Number(parseDefaultNumber(settings.undoDeleteSeconds, undoDefault));
    const clientErrors: Record<string, string> = {};
    if (!Number.isFinite(rateLimitRps)) clientErrors.rate_limit_rps = 'Nhập số hợp lệ';
    if (!Number.isFinite(rateLimitBurst)) clientErrors.rate_limit_burst = 'Nhập số hợp lệ';
    if (!Number.isFinite(undoDeleteSeconds) || undoDeleteSeconds < 0) {
      clientErrors.undo_delete_seconds = 'Nhập số ≥ 0';
    } else if (undoDeleteSeconds > 120) {
      clientErrors.undo_delete_seconds = 'Tối đa 120 giây';
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
        rate_limit_burst_enabled: settings.rateLimitBurstEnabled,
        rate_limit_rps: rateLimitRps,
        rate_limit_burst: rateLimitBurst,
        enable_metrics: settings.enableMetrics,
        enable_health_check: settings.enableHealthCheck,
        transform_enabled: settings.transformEnabled,
        retry_enabled: settings.retryEnabled,
        queue_enabled: settings.queueEnabled,
        undo_delete_seconds: Math.floor(undoDeleteSeconds),
      });
      setSettings(toForm(data));
      setSnapshot(data);
      await refreshUndoSeconds();
      toast.success('Đã lưu cài đặt');
    } catch (e) {
      handleFormApiError(e, setFieldErrors);
    } finally {
      setSaving(false);
    }
  };

  const handleResetSettings = () => {
    if (!snapshot) return;
    setSettings(toForm(snapshot));
    setFieldErrors({});
    toast.success('Đã khôi phục giá trị đã lưu');
  };

  return (
    <>
      <TechPageHeader
        codeLine="// settings · runtime · rate_limit"
        title="Cài đặt hệ thống"
       
        actions={
          <Button
            variant="outline"
            className="border-border font-mono-tech text-xs"
            onClick={() => void load()}
            disabled={loading || saving}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            refresh
          </Button>
        }
      />

      <EnterSubmitForm
        id="gateway-settings-form"
        className="contents"
        disabled={loading || saving || readOnly || !isDirty}
        onSubmit={() => void handleSaveSettings()}
      >
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 lg:gap-8 mb-24">
        <Card className="rounded-2xl bg-card/80 border-border overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-border flex items-center gap-2">
            <Gauge className="w-4 h-4 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-white">Rate limit toàn cục</h3>
              <p className="text-xs text-muted-foreground">Ưu tiên sau client limit và route limit.</p>
            </div>
          </div>
          <div className="p-5 sm:p-6">
            {loading || !settings || !snapshot ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-slate-900/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-white">Global rate limit</p>
                  </div>
                  <Switch
                    checked={settings.rateLimitEnabled}
                    disabled={readOnly}
                    onCheckedChange={(checked) => setSettings({ ...settings, rateLimitEnabled: checked })}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-slate-900/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-white">Burst</p>
                  </div>
                  <Switch
                    checked={settings.rateLimitBurstEnabled}
                    disabled={readOnly || !settings.rateLimitEnabled}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, rateLimitBurstEnabled: checked })
                    }
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        'bg-input border-border text-foreground mt-1.5',
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
                        'bg-input border-border text-foreground mt-1.5',
                      )}
                      disabled={readOnly || !settings.rateLimitEnabled || !settings.rateLimitBurstEnabled}
                    />
                    <FieldError message={fieldErrors.rate_limit_burst} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className="rounded-2xl bg-card/80 border-border overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-border flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-white">Runtime middleware</h3>
              <p className="text-xs text-muted-foreground">Bật/tắt tính năng data plane và observability.</p>
            </div>
          </div>
          <div className="px-5 sm:px-6 py-2">
            {loading || !settings ? (
              <p className="text-sm text-muted-foreground py-4">Đang tải…</p>
            ) : (
              <>
                {RUNTIME_TOGGLES.map((row) => (
                  <SettingToggleRow
                    key={row.key}
                    label={row.label}
                    description={row.description}
                    checked={settings[row.key]}
                    disabled={readOnly}
                    onCheckedChange={(c) => setSettings({ ...settings, [row.key]: c })}
                  />
                ))}
              </>
            )}
          </div>
        </Card>

        <Card className="rounded-2xl bg-card/80 border-border overflow-hidden xl:col-span-2">
          <div className="px-5 sm:px-6 py-4 border-b border-border flex items-center gap-2">
            <Timer className="w-4 h-4 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-white">Hoàn tác khi xóa</h3>
              <p className="text-xs text-muted-foreground">
                Cài đặt thời gian hoàn tác khi xóa.
              </p>
            </div>
          </div>
          <div className="p-5 sm:p-6">
            {loading || !settings || !snapshot ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : (
              <div className="max-w-xs">
                <Label className="text-foreground">Thời gian hoàn tác (giây)</Label>
                <Input
                  value={settings.undoDeleteSeconds}
                  onChange={(e) => {
                    setSettings({ ...settings, undoDeleteSeconds: e.target.value });
                    clearOneFieldError(setFieldErrors, 'undo_delete_seconds');
                  }}
                  {...defaultNumberHandlers(
                    settings.undoDeleteSeconds,
                    (v) => setSettings({ ...settings, undoDeleteSeconds: v }),
                    String(snapshot.undo_delete_seconds ?? 10),
                  )}
                  aria-invalid={Boolean(fieldErrors.undo_delete_seconds)}
                  className={fieldInputErrorClass(
                    Boolean(fieldErrors.undo_delete_seconds),
                    'bg-input border-border text-foreground mt-1.5',
                  )}
                  disabled={readOnly}
                />
                <FieldError message={fieldErrors.undo_delete_seconds} />
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  0 = xóa ngay, không hiện hoàn tác. Tối đa 120 giây.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
      </EnterSubmitForm>

      {(isDirty || !readOnly) && settings && snapshot ? (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 backdrop-blur-md px-4 sm:px-6 lg:px-8 py-3">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              {isDirty ? (
                <>
                  <HeartPulse className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-amber-200">Có thay đổi chưa lưu</span>
                </>
              ) : (
                <span>-</span>
              )}
            </p>
            <div className="flex gap-2 sm:gap-3">
              <Button
                variant="outline"
                className="flex-1 sm:flex-none border-border"
                onClick={handleResetSettings}
                disabled={loading || saving || readOnly || !isDirty}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Hoàn tác
              </Button>
              <Button
                type="submit"
                form="gateway-settings-form"
                className="flex-1 sm:flex-none bg-primary hover:bg-primary/90 min-w-[8rem]"
                disabled={loading || saving || readOnly || !isDirty}
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
