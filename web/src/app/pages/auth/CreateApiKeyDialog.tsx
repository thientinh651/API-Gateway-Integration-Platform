import { useState } from 'react';
import { Copy, KeyRound, Plus, Shield, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';
import {
  createClientKey,
  createClientKeyEncrypted,
  fetchGatewayPublicKey,
} from '../../../lib/api';
import { buildEncryptedEnvelope } from '../../../lib/rsaEnvelope';
import { ApiClientError } from '../../../lib/apiClientError';
import {
  handleFormApiError,
  failClientValidation,
  clearOneFieldError,
  fieldInputErrorClass,
} from '../../../lib/formValidation';
import { FieldError } from '../../components/forms/FieldError';
import { ClientKeyFlowSteps } from '../../components/auth/ClientKeyFlowSteps';
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
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { canWriteClientKeys } from '../../../lib/rbac';
import {
  CLIENT_KEY_INTEGRATION_TYPES,
} from './clientKeyIntegrationTypes';

type CreateMode = 'direct' | 'rsa';

type Props = {
  onKeysChanged: () => void;
};

export function CreateApiKeyDialog({ onKeysChanged }: Props) {
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
    setFieldErrors({});
  };

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
    try {
      if (mode === 'direct') {
        const res = await createClientKey(name.trim(), integrationType);
        setGeneratedApiKey(res.api_key);
        setGeneratedSecret(res.secret_key);
        setGeneratedName(res.name);
      } else {
        const { public_key_pem } = await fetchGatewayPublicKey();
        const envelope = await buildEncryptedEnvelope(public_key_pem, {
          name: name.trim(),
          integration_type: integrationType,
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
    const block = `API Key: ${generatedApiKey}\nSecret Key: ${generatedSecret}`;
    await navigator.clipboard.writeText(block);
    toast.success('Đã copy cả API Key và Secret');
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
          Tạo API Key
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-lg gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/80">
          <DialogTitle className="text-white flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            {created ? 'Key đã sẵn sàng' : 'Tạo client API Key'}
          </DialogTitle>
          <p className="text-xs text-muted-foreground text-left pt-1">
            {created
              ? 'Copy và lưu Secret ngay — dashboard không hiển thị lại.'
              : 'Key dùng để app gọi API qua gateway (header X-API-Key + chữ ký HMAC).'}
          </p>
        </DialogHeader>

        <div className="px-6 py-4">
          <ClientKeyFlowSteps activeStep={created ? 'copy' : 'create'} compact />
        </div>

        {!created ? (
          <div className="px-6 pb-6 space-y-4">
            {fieldErrors._form ? (
              <p className="text-sm text-red-400 border border-red-500/30 rounded-lg bg-red-500/10 px-3 py-2">
                {fieldErrors._form}
              </p>
            ) : null}
            <div>
              <Label className="text-foreground">Tên ứng dụng / đối tác</Label>
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
                  'mt-1.5 bg-input border-border text-foreground',
                )}
              />
              <FieldError message={fieldErrors.name} />
            </div>

            <div>
              <Label className="text-foreground">Mục đích sử dụng</Label>
              <Select value={integrationType} onValueChange={setIntegrationType}>
                <SelectTrigger className="bg-input border-border text-foreground mt-1.5">
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
                <Select value={mode} onValueChange={(v) => setMode(v as CreateMode)}>
                  <SelectTrigger className="bg-input border-border text-foreground h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direct">Thường — HTTPS (khuyến nghị)</SelectItem>
                    <SelectItem value="rsa">RSA envelope — demo enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </CollapsibleContent>
            </Collapsible>

            <Button
              onClick={() => void handleCreate()}
              className="w-full bg-primary hover:bg-primary/90"
              disabled={pending}
            >
              {pending ? 'Đang tạo…' : 'Tạo key'}
            </Button>
          </div>
        ) : (
          <div className="px-6 pb-6 space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2">
              <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/90 leading-relaxed">
                <strong className="text-amber-300">Secret chỉ trả về một lần.</strong> Server không lưu
                để xem lại — copy ngay. Che kiểu password trên trình duyệt không chặn DevTools; bảo mật
                thật là bạn lưu Secret ra ngoài dashboard.
              </p>
            </div>

            <CredentialRow
              label="API Key"
              hint="Public id — header X-API-Key"
              value={generatedApiKey}
              onCopy={() => void copyText(generatedApiKey, 'API Key')}
            />
            <SecretCredentialRow
              value={generatedSecret}
              onCopy={() => void copyText(generatedSecret, 'Secret')}
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
                <Sparkles className="w-4 h-4 mr-2" />
                Thử gọi proxy ngay
              </Button>
              <Button onClick={() => handleOpenChange(false)} variant="ghost" className="w-full">
                Đóng — tôi đã lưu Secret
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
  hint,
  value,
  onCopy,
}: {
  label: string;
  hint: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-slate-950/60 p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <Label className="text-foreground text-sm">{label}</Label>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
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
      <div className="flex items-center justify-between gap-2 mb-1">
        <Label className="text-foreground text-sm">Secret Key</Label>
        <span className="text-[10px] text-muted-foreground">Ký HMAC — không lưu trên server</span>
      </div>
      {showOnScreen ? (
        <pre className="mb-2 max-h-24 overflow-auto rounded-md border border-border bg-input px-3 py-2 font-mono text-xs text-foreground whitespace-pre-wrap break-all">
          {value}
        </pre>
      ) : (
        <p className="mb-2 rounded-md border border-dashed border-border/80 bg-slate-900/50 px-3 py-2 text-xs text-muted-foreground">
          Secret đã tạo ({value.length} ký tự). Bấm <strong className="text-slate-300">Copy</strong>{' '}
          để lấy — mặc định không hiện trên màn hình.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onCopy} size="sm" className="bg-primary hover:bg-primary/90">
          <Copy className="w-3.5 h-3.5 mr-1.5" />
          Copy Secret
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-border"
          onClick={() => setShowOnScreen((v) => !v)}
        >
          {showOnScreen ? 'Ẩn khỏi màn hình' : 'Hiện Secret trên màn hình'}
        </Button>
      </div>
      {showOnScreen ? (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Đã hiện plain text — ai có DevTools vẫn đọc được; chỉ dùng khi cần xem trực tiếp.
        </p>
      ) : null}
    </div>
  );
}
