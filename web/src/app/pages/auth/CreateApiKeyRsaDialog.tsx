import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import {
  createClientKeyEncrypted,
  fetchGatewayPublicKey,
  type CreateClientKeyResponse,
} from '../../../lib/api';
import { buildEncryptedEnvelope } from '../../../lib/rsaEnvelope';
import { handleFormApiError, failClientValidation, clearOneFieldError, fieldInputErrorClass } from '../../../lib/formValidation';
import { FieldError } from '../../components/forms/FieldError';
import { setTestHmacKeys } from '../../../lib/proxyTryStorage';
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

type Props = {
  onKeysChanged: () => void;
};

export function CreateApiKeyRsaDialog({ onKeysChanged }: Props) {
  const { user } = useAdminAuth();
  const canCreate = canWriteClientKeys(user);

  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [integrationType, setIntegrationType] = useState('partner');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CreateClientKeyResponse | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setName('');
    setIntegrationType('partner');
    setResult(null);
    setFieldErrors({});
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      failClientValidation(setFieldErrors, { name: 'Nhập tên app / đối tác' });
      return;
    }
    setPending(true);
    setFieldErrors({});
    try {
      const { public_key_pem } = await fetchGatewayPublicKey();
      const envelope = await buildEncryptedEnvelope(public_key_pem, {
        name: name.trim(),
        integration_type: integrationType,
      });
      const res = await createClientKeyEncrypted(envelope);
      setResult(res);
      onKeysChanged();
      toast.success('Đã tạo key — payload đã mã hóa bằng public key gateway');
    } catch (e) {
      handleFormApiError(e, setFieldErrors);
    } finally {
      setPending(false);
    }
  };

  if (!canCreate) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="border-primary/40 text-primary">
          <KeyRound className="w-4 h-4 mr-2" />
          Tạo key (RSA / WSO2)
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Mã hóa dữ liệu (WSO2-style)</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Browser lấy <strong className="text-foreground">public key</strong> gateway → mã hóa JSON
          (RSA-OAEP + AES-GCM) → server <strong className="text-foreground">private key</strong>{' '}
          giải mã. Data plane vẫn HMAC + HTTPS.
        </p>
        {!result ? (
          <div className="space-y-4 mt-2">
            <div>
              <Label>Tên ứng dụng / đối tác</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearOneFieldError(setFieldErrors, 'name');
                }}
                aria-invalid={Boolean(fieldErrors.name)}
                className={fieldInputErrorClass(Boolean(fieldErrors.name), 'mt-1')}
              />
              <FieldError message={fieldErrors.name} />
            </div>
            <div>
              <Label>Loại client</Label>
              <Select value={integrationType} onValueChange={setIntegrationType}>
                <SelectTrigger className="mt-1">
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
              className="w-full bg-primary"
              disabled={pending}
              onClick={() => void handleCreate()}
            >
              {pending ? 'Đang mã hóa & gửi…' : 'Mã hóa & tạo key'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 mt-2">
            <p className="text-xs text-emerald-400">Server đã giải mã envelope và tạo credential.</p>
            <Label>API Key</Label>
            <Input readOnly value={result.api_key} className="font-mono text-xs" />
            <Label>Secret (copy ngay)</Label>
            <Input readOnly value={result.secret_key} className="font-mono text-xs" />
            <Button
              className="w-full"
              onClick={() => {
                setTestHmacKeys(result.api_key, result.secret_key);
                toast.success('Đã lưu cho Thử Proxy');
              }}
            >
              Lưu cho Thử Proxy
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/proxy-try">Thử gọi Proxy</Link>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
