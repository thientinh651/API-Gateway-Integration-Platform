import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import {
  createClientKeyEncrypted,
  fetchGatewayPublicKey,
  type CreateClientKeyResponse,
} from '../../../lib/api';
import { buildEncryptedEnvelope } from '../../../lib/rsaEnvelope';
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

type Props = {
  onKeysChanged: () => void;
};

const INTEGRATION_TYPES = [
  { value: 'app', label: 'Ứng dụng / phần mềm' },
  { value: 'partner', label: 'Đối tác B2B' },
  { value: 'test', label: 'Thử nghiệm' },
] as const;

export function CreateApiKeyRsaDialog({ onKeysChanged }: Props) {
  const { user } = useAdminAuth();
  const canCreate = canWriteClientKeys(user);

  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [integrationType, setIntegrationType] = useState('partner');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CreateClientKeyResponse | null>(null);

  const reset = () => {
    setName('');
    setIntegrationType('partner');
    setResult(null);
  };

  const handleCreate = async () => {
    setPending(true);
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
      toast.error(e instanceof Error ? e.message : String(e));
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
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Mục đích</Label>
              <Select value={integrationType} onValueChange={setIntegrationType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTEGRATION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full bg-primary"
              disabled={!name.trim() || pending}
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
