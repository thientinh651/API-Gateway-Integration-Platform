import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  createClientKey,
  createClientKeyEncrypted,
  fetchGatewayPublicKey,
} from '../../../lib/api';
import { buildEncryptedEnvelope } from '../../../lib/rsaEnvelope';
import {
  handleFormApiError,
  failClientValidation,
  clearOneFieldError,
  fieldInputErrorClass,
} from '../../../lib/formValidation';
import { FieldError } from '../../components/forms/FieldError';
import { Link } from 'react-router';
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
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { canWriteClientKeys } from '../../../lib/rbac';
import {
  CLIENT_KEY_INTEGRATION_TYPES,
  CLIENT_KEY_TYPE_HINT,
} from './clientKeyIntegrationTypes';

type CreateMode = 'direct' | 'rsa';

type Props = {
  onKeysChanged: () => void;
};

export function CreateApiKeyDialog({ onKeysChanged }: Props) {
  const { user } = useAdminAuth();
  const canCreate = canWriteClientKeys(user);

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<CreateMode>('direct');
  const [generatedApiKey, setGeneratedApiKey] = useState('');
  const [generatedSecret, setGeneratedSecret] = useState('');
  const [purpose, setPurpose] = useState('');
  const [name, setName] = useState('');
  const [integrationType, setIntegrationType] = useState<string>('app');
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setMode('direct');
    setGeneratedApiKey('');
    setGeneratedSecret('');
    setPurpose('');
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
      failClientValidation(setFieldErrors, { name: 'Nhập tên app / đối tác' });
      return;
    }
    setPending(true);
    setFieldErrors({});
    try {
      if (mode === 'direct') {
        const res = await createClientKey(name.trim(), integrationType);
        setGeneratedApiKey(res.api_key);
        setGeneratedSecret(res.secret_key);
        setPurpose(res.purpose ?? '');
        toast.success('Cặp API Key + Secret đã tạo — copy ngay, không xem lại Secret');
      } else {
        const { public_key_pem } = await fetchGatewayPublicKey();
        const envelope = await buildEncryptedEnvelope(public_key_pem, {
          name: name.trim(),
          integration_type: integrationType,
        });
        const res = await createClientKeyEncrypted(envelope);
        setGeneratedApiKey(res.api_key);
        setGeneratedSecret(res.secret_key);
        setPurpose(res.purpose ?? '');
        toast.success('Đã tạo key — payload đã mã hóa RSA trước khi gửi server');
      }
      onKeysChanged();
    } catch (e) {
      handleFormApiError(e, setFieldErrors);
    } finally {
      setPending(false);
    }
  };

  const handleCopy = (key: string) => {
    void navigator.clipboard.writeText(key);
    toast.success('Đã copy');
  };

  if (!canCreate) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-primary hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Tạo API Key
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Tạo credential cho phần mềm</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Cùng kết quả: <strong className="text-foreground">avaso_pk_</strong> +{' '}
          <strong className="text-foreground">avaso_sk_</strong> để gọi data-plane (HMAC). Khác cách
          gửi yêu cầu tạo key lên server.
        </p>

        {!generatedApiKey ? (
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-foreground">Cách tạo</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as CreateMode)}>
                <SelectTrigger className="bg-input border-border text-foreground mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct">Thường — gửi qua HTTPS (dashboard)</SelectItem>
                  <SelectItem value="rsa">Mã hóa RSA — WSO2-style (public key gateway)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {mode === 'direct'
                  ? 'Đủ cho hầu hết trường hợp: session cookie + TLS bảo vệ tên app khi tạo key.'
                  : 'Browser mã hóa JSON bằng public key gateway (RSA-OAEP + AES-GCM) trước khi POST — demo tích hợp enterprise / WSO2.'}
              </p>
            </div>

            <div>
              <Label className="text-foreground">Tên (app / đối tác)</Label>
              <Input
                placeholder="mobile-app-prod"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearOneFieldError(setFieldErrors, 'name');
                }}
                aria-invalid={Boolean(fieldErrors.name)}
                className={fieldInputErrorClass(Boolean(fieldErrors.name), 'bg-input border-border text-foreground')}
              />
              <FieldError message={fieldErrors.name} />
            </div>
            <div>
              <Label className="text-foreground">Loại client</Label>
              <Select value={integrationType} onValueChange={setIntegrationType}>
                <SelectTrigger className="bg-input border-border text-foreground mt-1">
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
              <p className="text-xs text-muted-foreground mt-1">{CLIENT_KEY_TYPE_HINT}</p>
            </div>
            <Button
              onClick={() => void handleCreate()}
              className="w-full bg-primary hover:bg-primary/90"
              disabled={pending}
            >
              {pending
                ? mode === 'rsa'
                  ? 'Đang mã hóa & tạo…'
                  : 'Đang tạo…'
                : mode === 'rsa'
                  ? 'Mã hóa RSA & tạo key'
                  : 'Tạo key'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-amber-400 text-sm font-medium mb-2">Lưu ngay — chỉ hiện một lần</p>
              <p className="text-xs text-muted-foreground">
                {purpose ||
                  (mode === 'rsa'
                    ? 'Tạo qua envelope RSA — credential giống hệt chế độ thường.'
                    : 'API Key (pk) + Secret (sk) — HMAC qua HTTPS.')}
              </p>
            </div>
            <div>
              <Label className="text-foreground">API Key (avaso_pk_…)</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={generatedApiKey}
                  readOnly
                  className="bg-input border-border text-foreground font-mono text-xs"
                />
                <Button
                  onClick={() => handleCopy(generatedApiKey)}
                  className="bg-primary hover:bg-primary/90 shrink-0"
                >
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-foreground">Secret Key (avaso_sk_…)</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={generatedSecret}
                  readOnly
                  className="bg-input border-border text-foreground font-mono text-xs"
                />
                <Button
                  onClick={() => handleCopy(generatedSecret)}
                  className="bg-primary hover:bg-primary/90 shrink-0"
                >
                  Copy
                </Button>
              </div>
            </div>
            <Button asChild variant="outline" className="w-full border-border">
              <Link to="/proxy-try" onClick={() => handleOpenChange(false)}>
                Đi tới Thử gọi Proxy (dán key thủ công)
              </Link>
            </Button>
            <Button onClick={() => handleOpenChange(false)} className="w-full" variant="ghost">
              Đóng
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
