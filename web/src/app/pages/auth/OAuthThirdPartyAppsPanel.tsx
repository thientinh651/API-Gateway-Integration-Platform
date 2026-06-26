import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { fetchOAuthApps, type OAuthThirdPartyAppRow } from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';
import { CreateOAuthAppDialog } from './CreateOAuthAppDialog';
import { apiUrl } from '../../../lib/api';
import {
  defaultOAuthDemoRedirectUri,
  generatePkceVerifier,
  pkceChallengeS256,
  saveOAuthPkceSession,
} from '../../../lib/pkce';

type Props = {
  canCreate: boolean;
};

function parseUris(json: string): string[] {
  try {
    const arr = JSON.parse(json) as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function pickDemoRedirectUri(uris: string[]): string {
  const demo = defaultOAuthDemoRedirectUri();
  if (uris.includes(demo)) return demo;
  return uris[0] ?? demo;
}

export function OAuthThirdPartyAppsPanel({ canCreate }: Props) {
  const [apps, setApps] = useState<OAuthThirdPartyAppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchOAuthApps();
      setApps(res.apps);
    } catch (e) {
      toastApiError(e, 'Không tải danh sách app');
      setApps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const buildAuthorizeUrl = (
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
    state: string,
  ) => {
    const base = apiUrl('/oauth/authorize');
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'proxy:invoke',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${base}?${q.toString()}`;
  };

  const startAuthorize = async (clientId: string, redirectUri: string) => {
    setAuthorizingId(clientId);
    try {
      const state = crypto.randomUUID();
      const verifier = generatePkceVerifier();
      const challenge = await pkceChallengeS256(verifier);
      saveOAuthPkceSession(state, { verifier, clientId, redirectUri });
      const url = buildAuthorizeUrl(clientId, redirectUri, challenge, state);
      window.location.assign(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthorizingId(null);
    }
  };

  const demoRedirectHint = defaultOAuthDemoRedirectUri();

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/60 bg-slate-950/40 px-4 py-3 text-sm text-muted-foreground leading-relaxed">
        App bên thứ 3 dùng <strong className="text-slate-300 font-medium">Authorization Code + PKCE (S256)</strong>{' '}
        — user dashboard đăng nhập, consent, nhận <code className="text-slate-400">code</code>, đổi JWT với{' '}
        <code className="text-slate-400">code_verifier</code> tại token endpoint. Khác machine client (client_credentials).
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
        Demo redirect URI khuyến nghị:{' '}
        <code className="text-primary break-all">{demoRedirectHint}</code> — đăng ký URL này khi tạo app để thử end-to-end
        trên dashboard.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {canCreate ? <CreateOAuthAppDialog onCreated={() => void reload()} /> : null}
        <Button variant="outline" size="sm" className="border-border" onClick={() => void reload()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Làm mới
        </Button>
      </div>

      <Card className="border-border bg-card/50 overflow-hidden">
        {loading ? (
          <p className="px-4 py-8 text-center text-muted-foreground text-sm">Đang tải…</p>
        ) : apps.length === 0 ? (
          <p className="px-4 py-8 text-center text-muted-foreground text-sm">
            Chưa có app — admin đăng ký app và redirect URI.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {apps.map((app) => {
              const uris = parseUris(app.redirect_uris_json);
              const redirectUri = pickDemoRedirectUri(uris);
              const hasDemoUri = uris.includes(demoRedirectHint);
              return (
                <li key={app.id} className="px-4 py-4 hover:bg-primary/5 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-white">{app.name}</p>
                      <p className="text-xs font-mono text-slate-400 mt-0.5">{app.client_id}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-slate-400 border-border">
                        authorization_code
                      </Badge>
                      <Badge variant="outline" className="text-emerald-400/90 border-emerald-500/30">
                        PKCE S256
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Scope: <span className="font-mono text-slate-400">{app.scopes}</span> · Tạo{' '}
                    {formatDbTimestamp(app.created_at)}
                  </p>
                  <div className="text-xs text-slate-400 space-y-1">
                    <span className="text-muted-foreground">Redirect URI:</span>
                    {uris.map((u) => (
                      <div
                        key={u}
                        className={`font-mono break-all pl-2 ${u === demoRedirectHint ? 'text-primary' : ''}`}
                      >
                        {u}
                        {u === demoRedirectHint ? ' (demo callback)' : ''}
                      </div>
                    ))}
                  </div>
                  {redirectUri ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-border text-xs h-8"
                        onClick={() => {
                          void navigator.clipboard.writeText(app.client_id);
                          toast.success('Đã copy Client ID');
                        }}
                      >
                        <Copy className="w-3.5 h-3.5 mr-1" />
                        Copy Client ID
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-border text-xs h-8"
                        disabled={authorizingId === app.client_id}
                        onClick={() => void startAuthorize(app.client_id, redirectUri)}
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-1" />
                        {authorizingId === app.client_id ? 'Đang mở…' : 'Thử authorize (PKCE)'}
                      </Button>
                      {!hasDemoUri ? (
                        <span className="text-[10px] text-amber-400/90 self-center">
                          Thêm <code className="font-mono">{demoRedirectHint}</code> vào redirect URI để demo callback.
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
