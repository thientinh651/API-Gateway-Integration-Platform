import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
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
import type { ApiKeyRow } from './apiKeyTypes';

function generateKeyString() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'avaso_';
  for (let i = 0; i < 40; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

type Props = {
  onAdd: (row: ApiKeyRow) => void;
};

export function CreateApiKeyDialog({ onAdd }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [formData, setFormData] = useState({ name: '', rateLimit: '100' });

  const reset = () => {
    setGeneratedKey('');
    setFormData({ name: '', rateLimit: '100' });
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) reset();
  };

  const handleCreate = () => {
    const fullKey = generateKeyString();
    const newKey: ApiKeyRow = {
      id: Date.now().toString(),
      name: formData.name,
      key: `${fullKey.slice(0, 6)}***************************${fullKey.slice(-6)}`,
      isActive: true,
      createdAt: new Date().toISOString().split('T')[0],
      rateLimitPerMinute: parseInt(formData.rateLimit, 10),
    };
    onAdd(newKey);
    setGeneratedKey(fullKey);
    toast.success('API Key đã được tạo thành công');
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
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-input border-border text-foreground"
              />
            </div>
            <div>
              <Label className="text-foreground">Rate Limit (req/min)</Label>
              <Input
                type="number"
                value={formData.rateLimit}
                onChange={(e) => setFormData({ ...formData, rateLimit: e.target.value })}
                className="bg-input border-border text-foreground"
              />
            </div>
            <Button
              onClick={handleCreate}
              className="w-full bg-primary hover:bg-primary/90"
              disabled={!formData.name}
            >
              Generate Key
            </Button>
          </div>
        ) : (
          <div className="space-y-4 mt-4">
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-amber-400 text-sm font-medium mb-2">Lưu ý quan trọng</p>
              <p className="text-xs text-muted-foreground">
                Đây là lần duy nhất bạn có thể thấy API key đầy đủ. Sao chép và lưu an toàn.
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
            <Button onClick={() => handleOpenChange(false)} className="w-full" variant="outline">
              Đóng
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
