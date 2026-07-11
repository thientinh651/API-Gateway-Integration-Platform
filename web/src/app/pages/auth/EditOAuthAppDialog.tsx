import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { updateOAuthApp, type OAuthThirdPartyAppRow } from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
import { formatRedirectUrisForInput, parseRedirectUrisInput } from '../../../lib/oauthAppUris';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { EnterSubmitForm } from '../../components/forms/EnterSubmitForm';

type Props = {
  app: OAuthThirdPartyAppRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function EditOAuthAppDialog({ app, open, onOpenChange, onSaved }: Props) {
  const [name, setName] = useState('');
  const [urisText, setUrisText] = useState('');
  const [rotateSecret, setRotateSecret] = useState(false);
  const [pending, setPending] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  useEffect(() => {
    if (!app || !open) return;
    setName(app.name);
    try {
      const arr = JSON.parse(app.redirect_uris_json) as string[];
      setUrisText(formatRedirectUrisForInput(Array.isArray(arr) ? arr : []));
    } catch {
      setUrisText('');
    }
    setRotateSecret(false);
    setNewSecret(null);
  }, [app, open]);

  const handleSave = async () => {
    if (!app) return;
    const appName = name.trim();
    const redirect_uris = parseRedirectUrisInput(urisText);
    if (!appName || redirect_uris.length === 0) {
      toast.error('Nhập tên app và ít nhất một redirect URI');
      return;
    }
    setPending(true);
    try {
      const res = await updateOAuthApp(app.id, {
        name: appName,
        redirect_uris,
        rotate_secret: rotateSecret,
      });
      if (res.client_secret) {
        setNewSecret(res.client_secret);
        toast.success('Đã cập nhật — lưu client secret mới ngay');
      } else {
        toast.success('Đã cập nhật app');
        onSaved();
        onOpenChange(false);
      }
    } catch (e) {
      toastApiError(e, 'Cập nhật thất bại');
    } finally {
      setPending(false);
    }
  };

  const closeAfterSecret = () => {
    setNewSecret(null);
    onSaved();
    onOpenChange(false);
  };

  if (!app) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Sửa app OAuth</DialogTitle>
        </DialogHeader>

        {newSecret ? (
          <div className="space-y-4">
            <p className="text-sm text-amber-200/90 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              Client secret mới — chỉ hiện một lần. Copy trước khi đóng.
            </p>
            <code className="block text-xs font-mono text-emerald-400 break-all">{newSecret}</code>
            <Button className="w-full" onClick={closeAfterSecret}>
              Đã lưu secret — đóng
            </Button>
          </div>
        ) : (
          <EnterSubmitForm className="space-y-4" disabled={pending} onSubmit={() => void handleSave()}>
            <div>
              <Label className="text-foreground">Tên app</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 bg-input border-border"
              />
            </div>
            <div>
              <Label className="text-foreground">Client ID (không đổi)</Label>
              <code className="mt-1.5 block text-xs font-mono text-slate-400 break-all">{app.client_id}</code>
            </div>
            <div>
              <Label className="text-foreground">Redirect URI (mỗi dòng một URL)</Label>
              <textarea
                value={urisText}
                onChange={(e) => setUrisText(e.target.value)}
                rows={4}
                className="mt-1.5 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground font-mono"
              />
            </div>
            {app.has_secret ? (
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <Checkbox checked={rotateSecret} onCheckedChange={(v) => setRotateSecret(v === true)} />
                Tạo client secret mới (rotate)
              </label>
            ) : (
              <p className="text-xs text-muted-foreground">Public app (PKCE) — không có client secret.</p>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1 border-border" onClick={() => onOpenChange(false)}>
                Hủy
              </Button>
              <Button type="submit" className="flex-1" disabled={pending}>
                {pending ? 'Đang lưu…' : 'Cập nhật'}
              </Button>
            </div>
          </EnterSubmitForm>
        )}
      </DialogContent>
    </Dialog>
  );
}
