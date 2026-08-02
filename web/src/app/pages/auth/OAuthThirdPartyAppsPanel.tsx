import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Edit, ExternalLink, RefreshCw } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { ConfirmDangerButton } from '../../components/forms/ConfirmDangerButton';
import { deleteOAuthApp, fetchOAuthApps, type OAuthThirdPartyAppRow } from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';
import { parseRedirectUrisInput } from '../../../lib/oauthAppUris';
import { CreateOAuthAppDialog } from './CreateOAuthAppDialog';
import { EditOAuthAppDialog } from './EditOAuthAppDialog';
import { apiUrl } from '../../../lib/api';
import {
  defaultOAuthDemoRedirectUri,
  generatePkceVerifier,
  pkceChallengeS256,
  saveOAuthPkceSession,
} from '../../../lib/pkce';

type Props = {
  canManage: boolean;
};

function parseUris(json: string): string[] {
  try {
    const arr = JSON.parse(json) as string[];
    return parseRedirectUrisInput(Array.isArray(arr) ? arr.join('\n') : '');
  } catch {
    return [];
  }
}

function pickDemoRedirectUri(uris: string[]): string {
  const demo = defaultOAuthDemoRedirectUri();
  if (uris.includes(demo)) return demo;
  return uris[0] ?? demo;
}

export function OAuthThirdPartyAppsPanel({ canManage }: Props) {
  const [apps, setApps] = useState<OAuthThirdPartyAppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);
  const [editApp, setEditApp] = useState<OAuthThirdPartyAppRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);

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

  const openEdit = (app: OAuthThirdPartyAppRow) => {
    setEditApp(app);
    setEditOpen(true);
  };

  const handleDelete = async (app: OAuthThirdPartyAppRow) => {
    try {
      await deleteOAuthApp(app.id);
      toast.success(`Đã xóa app "${app.name}"`);
      await reload();
    } catch (e) {
      toastApiError(e, 'Xóa app thất bại');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {canManage ? <CreateOAuthAppDialog onCreated={() => void reload()} /> : null}
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
                      {app.has_secret ? (
                        <Badge variant="outline" className="text-sky-400/90 border-sky-500/30">
                          confidential
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-500 border-border">
                          public
                        </Badge>
                      )}
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
                      {canManage ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-border text-xs h-8"
                            onClick={() => openEdit(app)}
                          >
                            <Edit className="w-3.5 h-3.5 mr-1" />
                            Sửa
                          </Button>
                          <ConfirmDangerButton
                            title={`Xóa app "${app.name}"?`}
                            description="Client ID sẽ vô hiệu — consent và auth code liên quan bị xóa."
                            confirmLabel="Xóa app"
                            variant="outline"
                            size="sm"
                            className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-8 text-xs"
                            onConfirm={() => handleDelete(app)}
                          >
                            Xóa
                          </ConfirmDangerButton>
                        </>
                      ) : null}
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

      <EditOAuthAppDialog
        app={editApp}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => void reload()}
      />
    </div>
  );
}
