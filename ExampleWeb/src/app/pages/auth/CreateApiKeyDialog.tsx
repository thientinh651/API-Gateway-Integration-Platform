import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createClientKey } from '../../../lib/api';
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
  { value: 'app', label: 'Ứng dụng / phần mềm (mobile, web, script)' },
  { value: 'partner', label: 'Đối tác B2B' },
  { value: 'salesforce', label: 'Tích hợp Salesforce (chuẩn bị)' },
  { value: 'zoho', label: 'Tích hợp Zoho (chuẩn bị)' },
  { value: 'test', label: 'Thử nghiệm / dev' },
] as const;

export function CreateApiKeyDialog({ onKeysChanged }: Props) {
  const { user } = useAdminAuth();
  const canCreate = canWriteClientKeys(user);

  const [isOpen, setIsOpen] = useState(false);
  const [generatedApiKey, setGeneratedApiKey] = useState('');
  const [generatedSecret, setGeneratedSecret] = useState('');
  const [purpose, setPurpose] = useState('');
  const [name, setName] = useState('');
  const [integrationType, setIntegrationType] = useState<string>('app');
  const [pending, setPending] = useState(false);

  const reset = () => {
    setGeneratedApiKey('');
    setGeneratedSecret('');
    setPurpose('');
    setName('');
    setIntegrationType('app');
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) reset();
  };

  const handleCreate = async () => {
    setPending(true);
    try {
      const res = await createClientKey(name.trim(), integrationType);
      setGeneratedApiKey(res.api_key);
      setGeneratedSecret(res.secret_key);
      setPurpose(res.purpose ?? '');
      onKeysChanged();
      toast.success('Cặp API Key + Secret đã tạo — copy ngay, không xem lại Secret');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
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
          Admin cấp cho <strong className="text-foreground">ứng dụng / tích hợp</strong>, không phải
          cặp RSA. User dashboard dùng username/password riêng.
        </p>
        {!generatedApiKey ? (
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-foreground">Tên (app / đối tác)</Label>
              <Input
                placeholder="mobile-app-prod"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-input border-border text-foreground"
              />
            </div>
            <div>
              <Label className="text-foreground">Mục đích</Label>
              <Select value={integrationType} onValueChange={setIntegrationType}>
                <SelectTrigger className="bg-input border-border text-foreground">
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
              onClick={() => void handleCreate()}
              className="w-full bg-primary hover:bg-primary/90"
              disabled={!name.trim() || pending}
            >
              {pending ? 'Đang tạo…' : 'Tạo trên gateway'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-amber-400 text-sm font-medium mb-2">Lưu ngay — chỉ hiện một lần</p>
              <p className="text-xs text-muted-foreground">
                {purpose || 'API Key (pk) + Secret (sk) — HMAC qua HTTPS. Không phải public/private RSA.'}
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
            <Button
              type="button"
              className="w-full bg-primary/90 hover:bg-primary"
              onClick={() => {
                setTestHmacKeys(generatedApiKey, generatedSecret);
                toast.success('Đã lưu cặp key cho trang Thử gọi Proxy.');
              }}
            >
              Lưu cho Thử Proxy
            </Button>
            <Button asChild variant="outline" className="w-full border-border">
              <Link to="/proxy-try" onClick={() => handleOpenChange(false)}>
                Đi tới Thử gọi Proxy
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
