import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, Shield, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';
import {
  createClientKey,
  createClientKeyEncrypted,
  fetchGatewayPublicKey,
  fetchGatewayRoutes,
} from '../../../lib/api';
import type { GatewayRouteRow } from '../../../lib/gatewayRoutes';
import { buildEncryptedEnvelope } from '../../../lib/rsaEnvelope';
import { ApiClientError } from '../../../lib/apiClientError';
import {
  handleFormApiError,
  failClientValidation,
  clearOneFieldError,
  fieldInputErrorClass,
} from '../../../lib/formValidation';
import { FieldError } from '../../components/forms/FieldError';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { canWriteClientKeys } from '../../../lib/rbac';
import {
  CLIENT_KEY_INTEGRATION_TYPES,
} from './clientKeyIntegrationTypes';
import { defaultNumberHandlers, parseDefaultNumber } from '../../../lib/zeroDefaultNumberInput';

type CreateMode = 'direct' | 'rsa';

type Props = {
  onKeysChanged: () => void;
  presetIntegrationType?: string | null;
  onPresetConsumed?: () => void;
};

export function CreateApiKeyDialog({
  onKeysChanged,
  presetIntegrationType,
  onPresetConsumed,
}: Props) {
  const { user } = useAdminAuth();
  const navigate = useNavigate();
  const canCreate = canWriteClientKeys(user);

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<CreateMode>('direct');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [generatedApiKey, setGeneratedApiKey] = useState('');
  const [generatedSecret, setGeneratedSecret] = useState('');
  const [generatedName, setGeneratedName] = useState('');
  const [name, setName] = useState('');
  const [integrationType, setIntegrationType] = useState<string>('app');
  const [rateLimitPerMin, setRateLimitPerMin] = useState('0');
  const [routes, setRoutes] = useState<GatewayRouteRow[]>([]);
  const [restrictRoutes, setRestrictRoutes] = useState(false);
  const [selectedRouteIds, setSelectedRouteIds] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setMode('direct');
    setAdvancedOpen(false);
    setGeneratedApiKey('');
    setGeneratedSecret('');
    setGeneratedName('');
    setName('');
    setIntegrationType('app');
    setRateLimitPerMin('0');
    setRestrictRoutes(false);
    setSelectedRouteIds([]);
    setFieldErrors({});
  };

  useEffect(() => {
    if (!isOpen) return;
    void fetchGatewayRoutes()
      .then(setRoutes)
      .catch(() => setRoutes([]));
  }, [isOpen]);

  useEffect(() => {
    if (!presetIntegrationType) return;
    const allowed = CLIENT_KEY_INTEGRATION_TYPES.some((t) => t.value === presetIntegrationType);
    if (!allowed) return;
    setIntegrationType(presetIntegrationType);
    setIsOpen(true);
    onPresetConsumed?.();
  }, [presetIntegrationType, onPresetConsumed]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) reset();
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      failClientValidation(setFieldErrors, { name: 'Đặt tên để nhận diện key (vd: mobile-app)' });
      return;
    }
    setPending(true);
    setFieldErrors({});
    const rl = Number.parseInt(parseDefaultNumber(rateLimitPerMin, '0'), 10);
    if (!Number.isFinite(rl) || rl < 0 || rl > 1_000_000) {
      failClientValidation(setFieldErrors, {
        rate_limit_per_min: 'Rate limit từ 0 - 1.000.000 req/phút',
      });
      setPending(false);
      return;
    }
    if (restrictRoutes && selectedRouteIds.length === 0) {
      failClientValidation(setFieldErrors, {
        route_ids: 'Chọn ít nhất một route hoặc tắt giới hạn ACL',
      });
      setPending(false);
      return;
    }
    try {
      const routeIds = restrictRoutes ? selectedRouteIds : [];
      if (mode === 'direct') {
        const res = await createClientKey(name.trim(), integrationType, rl, routeIds);
        setGeneratedApiKey(res.api_key);
        setGeneratedSecret(res.secret_key);
        setGeneratedName(res.name);
      } else {
        const { public_key_pem } = await fetchGatewayPublicKey();
        const envelope = await buildEncryptedEnvelope(public_key_pem, {
          name: name.trim(),
          integration_type: integrationType,
          rate_limit_per_min: rl,
          route_ids: routeIds,
        });
        const res = await createClientKeyEncrypted(envelope);
        setGeneratedApiKey(res.api_key);
        setGeneratedSecret(res.secret_key);
        setGeneratedName(res.name);
      }
      onKeysChanged();
    } catch (e) {
      if (e instanceof ApiClientError && e.status >= 500) {
        onKeysChanged();
      }
      const handled = handleFormApiError(e, setFieldErrors);
      if (!handled && e instanceof ApiClientError) {
        setFieldErrors({ _form: e.message });
      }
    } finally {
      setPending(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`Đã copy ${label}`);
  };

  const copyBoth = async () => {
    const block = `Client ID: ${generatedApiKey}\nClient Secret: ${generatedSecret}`;
    await navigator.clipboard.writeText(block);
    toast.success('Đã copy Client ID và Client Secret');
  };

  const goTryProxy = () => {
    handleOpenChange(false);
    navigate('/proxy-try');
  };

  if (!canCreate) return null;

  const created = Boolean(generatedApiKey);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-primary hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Đăng ký client
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-lg gap-0 p-0 overflow-hidden flex max-h-[min(90vh,720px)] flex-col">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-border/80">
          <DialogTitle className="text-white flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            {created ? 'Client đã đăng ký' : 'Đăng ký client mới'}
          </DialogTitle>
        </DialogHeader>

        {!created ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6 space-y-5">
            {fieldErrors._form ? (
              <p className="text-sm text-red-400 border border-red-500/30 rounded-lg bg-red-500/10 px-3 py-2">
                {fieldErrors._form}
              </p>
            ) : null}
                       <div className="space-y-2">
              <Input
                placeholder="vd: mobile-app-prod, đối-tác-ABC"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearOneFieldError(setFieldErrors, 'name');
                }}
                aria-invalid={Boolean(fieldErrors.name)}
                className={fieldInputErrorClass(
                  Boolean(fieldErrors.name),
                  'bg-input border-border text-foreground',
                )}
              />
              <FieldError message={fieldErrors.name} />
            </div>

            <div className="space-y-2">
              <Label className="text-foreground block">Loại client</Label>
              <Select value={integrationType} onValueChange={setIntegrationType}>
                <SelectTrigger className="w-full bg-input border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_KEY_INTEGRATION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-foreground block">Rate limit (req/phút)</Label>
              <Input
                type="number"
                min={0}
                max={1_000_000}
                value={rateLimitPerMin}
                onChange={(e) => {
                  setRateLimitPerMin(e.target.value);
                  clearOneFieldError(setFieldErrors, 'rate_limit_per_min');
                }}
                {...defaultNumberHandlers(rateLimitPerMin, setRateLimitPerMin, '0')}
                className={fieldInputErrorClass(
                  Boolean(fieldErrors.rate_limit_per_min),
                  'bg-input border-border text-foreground',
                )}
                placeholder="0 — kế thừa route/global"
              />
              <FieldError message={fieldErrors.rate_limit_per_min} />
            </div>

            <div className="rounded-lg border border-border/60 bg-slate-950/40 p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={restrictRoutes}
                  onChange={(e) => setRestrictRoutes(e.target.checked)}
                />
                Giới hạn route được gọi (ACL)
              </label>
              {restrictRoutes ? (
                <div className="max-h-32 overflow-y-auto rounded border border-border">
                  {routes.length === 0 ? (
                    <p className="p-2 text-xs text-muted-foreground">Chưa có route.</p>
                  ) : (
                    routes.map((r) => (
                      <label
                        key={r.id}
                        className="flex items-center gap-2 px-2 py-1.5 text-xs border-b border-border/40 last:border-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedRouteIds.includes(r.id)}
                          onChange={() =>
                            setSelectedRouteIds((prev) =>
                              prev.includes(r.id)
                                ? prev.filter((x) => x !== r.id)
                                : [...prev, r.id],
                            )
                          }
                        />
                        <span className="font-mono text-slate-300 truncate">{r.path}</span>
                      </label>
                    ))
                  )}
                </div>
              ) : null}
              <FieldError message={fieldErrors.route_ids} />
            </div>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-slate-300 underline-offset-2 hover:underline"
                >
                  Tùy chọn nâng cao (mã hóa RSA) {advancedOpen ? '▲' : '▼'}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-2 rounded-lg border border-border/60 bg-slate-950/50 p-3">
                <Label className="text-xs text-muted-foreground">Chế độ tạo</Label>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => setMode(v as CreateMode)}
                  className="gap-2"
                >
                  <label
                    className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${
                      mode === 'direct'
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border/60 hover:border-border'
                    }`}
                  >
                    <RadioGroupItem value="direct" className="mt-0.5" />
                    <span className="text-xs leading-relaxed">
                      <span className="font-medium text-slate-200">Thường — HTTPS</span>
                      <span className="text-muted-foreground"> · khuyến nghị</span>
                    </span>
                  </label>
                  <label
                    className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${
                      mode === 'rsa'
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border/60 hover:border-border'
                    }`}
                  >
                    <RadioGroupItem value="rsa" className="mt-0.5" />
                    <span className="text-xs leading-relaxed text-slate-300">
                      RSA envelope — mã hóa payload đăng ký (tùy chọn)
                    </span>
                  </label>
                </RadioGroup>
              </CollapsibleContent>
            </Collapsible>

            <Button
              onClick={() => void handleCreate()}
              className="w-full bg-primary hover:bg-primary/90"
              disabled={pending}
            >
              {pending ? 'Đang đăng ký…' : 'Đăng ký client'}
            </Button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6 space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2">
              <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/90 leading-relaxed">
                <strong className="text-amber-300">Secret chỉ hiện một lần.</strong> Copy và lưu ngay.
              </p>
            </div>

            <CredentialRow
              label="Client ID"
              value={generatedApiKey}
              onCopy={() => void copyText(generatedApiKey, 'Client ID')}
            />
            <SecretCredentialRow
              value={generatedSecret}
              onCopy={() => void copyText(generatedSecret, 'Client Secret')}
            />

            <div className="flex flex-col gap-2 pt-1">
              <Button
                onClick={() => void copyBoth()}
                variant="outline"
                className="w-full border-border"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy cả hai
              </Button>
              <Button onClick={goTryProxy} className="w-full bg-primary hover:bg-primary/90">

                Thử gọi proxy ngay
              </Button>
              <Button onClick={() => handleOpenChange(false)} variant="ghost" className="w-full">
                Đóng
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CredentialRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-slate-950/60 p-3">
      <Label className="text-foreground text-sm mb-2 block">{label}</Label>
      <div className="flex gap-2">
        <Input
          value={value}
          readOnly
          type="text"
          className="bg-input border-border text-foreground font-mono text-xs h-9"
        />
        <Button onClick={onCopy} size="sm" className="shrink-0 bg-primary hover:bg-primary/90">
          Copy
        </Button>
      </div>
    </div>
  );
}

/** Secret không gắn vào input — tránh value trong DOM cho tới khi user chủ động hiện. */
function SecretCredentialRow({ value, onCopy }: { value: string; onCopy: () => void }) {
  const [showOnScreen, setShowOnScreen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-slate-950/60 p-3">
      <Label className="text-foreground text-sm mb-2 block">Client Secret</Label>
      {showOnScreen ? (
        <pre className="mb-2 max-h-24 overflow-auto rounded-md border border-border bg-input px-3 py-2 font-mono text-xs text-foreground whitespace-pre-wrap break-all">
          {value}
        </pre>
      ) : (
        <p className="mb-2 rounded-md border border-dashed border-border/80 bg-slate-900/50 px-3 py-2 text-xs text-muted-foreground">
          Bấm <strong className="text-slate-300">Copy</strong> để lấy Secret.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onCopy} size="sm" className="bg-primary hover:bg-primary/90">
          <Copy className="w-3.5 h-3.5 mr-1.5" />
          Copy Client Secret
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-border"
          onClick={() => setShowOnScreen((v) => !v)}
        >
          {showOnScreen ? 'Ẩn' : 'Hiện Secret'}
        </Button>
      </div>
    </div>
  );
}
