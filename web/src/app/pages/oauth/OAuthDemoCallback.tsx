import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle2, KeyRound, ShieldAlert } from 'lucide-react';
import { apiUrl } from '../../../lib/api';
import {
  clearOAuthPkceSession,
  loadOAuthPkceSession,
  type OAuthPkceSession,
} from '../../../lib/pkce';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

type TokenResult = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export function OAuthDemoCallback() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code') ?? '';
  const state = searchParams.get('state') ?? '';
  const error = searchParams.get('error') ?? '';
  const session = useMemo(
    () => (state ? loadOAuthPkceSession(state) : null),
    [state],
  );
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<TokenResult | null>(null);

  const exchange = async (pkce: OAuthPkceSession) => {
    if (!code) {
      toast.error('Thiếu authorization code');
      return;
    }
    setBusy(true);
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: pkce.clientId,
        redirect_uri: pkce.redirectUri,
        code_verifier: pkce.verifier,
      });
      if (clientSecret.trim()) {
        body.set('client_secret', clientSecret.trim());
      }
      const res = await fetch(apiUrl('/api/oauth/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const json = (await res.json()) as TokenResult & { error?: string; message?: string };
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`);
      }
      setToken(json);
      clearOAuthPkceSession(state);
      toast.success('Đổi code thành công (PKCE + authorization_code)');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <Card className="w-full max-w-lg border-border bg-card/90 p-6 space-y-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-1">OAuth PKCE</p>
          <h1 className="text-xl font-bold text-white">Demo callback</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Redirect URI nội bộ — nhận <code className="text-slate-400">code</code> và đổi token với{' '}
            <code className="text-slate-400">code_verifier</code> đã lưu session.
          </p>
        </div>

        {error ? (
          <div className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              OAuth từ chối: <strong>{error}</strong>
            </span>
          </div>
        ) : null}

        {code ? (
          <div className="space-y-2 text-xs">
            <Label className="text-muted-foreground">Authorization code</Label>
            <code className="block font-mono text-emerald-400 break-all bg-slate-950/60 border border-border rounded-md p-2">
              {code}
            </code>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Chưa có code trong URL.</p>
        )}

        {state ? (
          <p className="text-xs text-muted-foreground">
            state: <span className="font-mono text-slate-400">{state}</span>
          </p>
        ) : null}

        {!session && code ? (
          <p className="text-sm text-amber-300/90 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            Không tìm thấy <code className="text-amber-200">code_verifier</code> trong session — bắt đầu lại từ{' '}
            <strong>Thử authorize</strong> trên tab App bên thứ 3.
          </p>
        ) : null}

        {session ? (
          <div className="space-y-3 rounded-lg border border-border/60 bg-slate-950/40 p-3">
            <p className="text-xs text-muted-foreground">
              client_id: <span className="font-mono text-slate-300">{session.clientId}</span>
            </p>
            <p className="text-xs text-muted-foreground break-all">
              code_verifier: <span className="font-mono text-slate-400">{session.verifier}</span>
            </p>
            <div>
              <Label className="text-xs text-muted-foreground">Client secret (nếu confidential app)</Label>
              <Input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="avaso_csec_…"
                className="mt-1 bg-input border-border font-mono text-xs"
                autoComplete="off"
              />
            </div>
            <Button
              className="w-full bg-primary hover:bg-primary/90"
              disabled={busy || !code}
              onClick={() => void exchange(session)}
            >
              <KeyRound className="w-4 h-4 mr-2" />
              {busy ? 'Đang đổi token…' : 'Đổi code → JWT'}
            </Button>
          </div>
        ) : null}

        {token ? (
          <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" />
              access_token nhận được
            </div>
            <code className="block text-[10px] font-mono text-slate-200 break-all max-h-32 overflow-y-auto">
              {token.access_token}
            </code>
            <p className="text-xs text-muted-foreground">
              {token.token_type} · expires_in {token.expires_in}s
            </p>
          </div>
        ) : null}

        <Button asChild variant="outline" className="w-full border-border">
          <Link to="/auth">← OAuth & Clients</Link>
        </Button>
      </Card>
    </div>
  );
}
