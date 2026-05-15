import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createClientKey } from '../../../lib/api';
import { setTestClientKey } from '../../../lib/proxyTryStorage';
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

type Props = {
  onKeysChanged: () => void;
};

export function CreateApiKeyDialog({ onKeysChanged }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);

  const reset = () => {
    setGeneratedKey('');
    setName('');
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) reset();
  };

  const handleCreate = async () => {
    setPending(true);
    try {
      const res = await createClientKey(name.trim());
      setGeneratedKey(res.api_key);
      onKeysChanged();
      toast.success('API key đã tạo — copy ngay, không xem lại được');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const handleCopy = (key: string) => {
    void navigator.clipboard.writeText(key);
    toast.success('Đã copy API key');
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-primary hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Tạo API Key
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-white">Tạo API Key mới</DialogTitle>
        </DialogHeader>
        {!generatedKey ? (
          <div className="space-y-4 mt-4">
            <div>
              <Label className="text-foreground">Tên</Label>
              <Input
                placeholder="Production App"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-input border-border text-foreground"
              />
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
          <div className="space-y-4 mt-4">
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-amber-400 text-sm font-medium mb-2">Lưu ý quan trọng</p>
              <p className="text-xs text-muted-foreground">
                Đây là lần duy nhất bạn thấy plaintext. Gateway chỉ lưu SHA-256 trong SQLite.
              </p>
            </div>
            <div>
              <Label className="text-foreground">API Key</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={generatedKey}
                  readOnly
                  className="bg-input border-border text-foreground font-mono text-xs"
                />
                <Button onClick={() => handleCopy(generatedKey)} className="bg-primary hover:bg-primary/90 shrink-0">
                  Copy
                </Button>
              </div>
            </div>
            <Button
              type="button"
              className="w-full bg-primary/90 hover:bg-primary"
              onClick={() => {
                setTestClientKey(generatedKey);
                toast.success('Đã lưu key cho trang Thử gọi Proxy.');
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
