import { useState } from 'react';
import { Plus, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { createOAuthApp } from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
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
import { Checkbox } from '../../components/ui/checkbox';

type Props = {
  onCreated: () => void;
};

export function CreateOAuthAppDialog({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [urisText, setUrisText] = useState('https://example.com/oauth/callback');
  const [withSecret, setWithSecret] = useState(true);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    client_id: string;
    client_secret: string | null;
  } | null>(null);

  const reset = () => {
    setName('');
    setUrisText('https://example.com/oauth/callback');
    setWithSecret(true);
    setResult(null);
    setPending(false);
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) reset();
  };

  const handleCreate = async () => {
    const appName = name.trim();
    const redirect_uris = urisText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!appName || redirect_uris.length === 0) {
      toast.error('Nhập tên app và ít nhất một redirect URI');
      return;
    }
    setPending(true);
    try {
      const res = await createOAuthApp({ name: appName, redirect_uris, with_secret: withSecret });
      setResult({ client_id: res.client_id, client_secret: res.client_secret });
      onCreated();
      toast.success('Đã tạo app OAuth');
    } catch (e) {
      toastApiError(e, 'Tạo app thất bại');
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-primary hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Đăng ký app
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">App OAuth bên thứ 3</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <p className="text-sm text-amber-200/90 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              Lưu credential ngay. Secret chỉ hiện một lần.
            </p>
            <div>
              <Label className="text-xs text-muted-foreground">Client ID</Label>
              <code className="mt-1 block text-xs font-mono text-slate-200 break-all">{result.client_id}</code>
            </div>
            {result.client_secret ? (
              <div>
                <Label className="text-xs text-muted-foreground">Client Secret</Label>
                <code className="mt-1 block text-xs font-mono text-emerald-400 break-all">
                  {result.client_secret}
                </code>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Public app — không có secret (PKCE demo).</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-border"
                onClick={() => {
                  const text = result.client_secret
                    ? `client_id=${result.client_id}\nclient_secret=${result.client_secret}`
                    : result.client_id;
                  void navigator.clipboard.writeText(text);
                  toast.success('Đã copy');
                }}
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
              <Button className="flex-1" onClick={() => handleOpenChange(false)}>
                Đóng
              </Button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Luồng: user đăng nhập dashboard →{' '}
              <code className="text-slate-400">GET /oauth/authorize?client_id=…&response_type=code</code> → đổi
              code tại <code className="text-slate-400">POST /api/oauth/token</code>.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-foreground">Tên app</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Partner Portal"
                className="mt-1.5 bg-input border-border"
              />
            </div>
            <div>
              <Label className="text-foreground">Redirect URI (mỗi dòng một URL)</Label>
              <textarea
                value={urisText}
                onChange={(e) => setUrisText(e.target.value)}
                rows={3}
                className="mt-1.5 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground font-mono"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <Checkbox checked={withSecret} onCheckedChange={(v) => setWithSecret(v === true)} />
              Tạo client secret (confidential app)
            </label>
            <Button className="w-full" disabled={pending} onClick={() => void handleCreate()}>
              {pending ? 'Đang tạo…' : 'Tạo app'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
