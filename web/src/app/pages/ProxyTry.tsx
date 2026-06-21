import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { FlaskConical, KeyRound, Play, Route, ScrollText, Send, ShieldAlert } from 'lucide-react';
import { fetchClientKeys, type ClientKeyMeta } from '../../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { PathAutocomplete } from '../components/forms/PathAutocomplete';
import { PasswordManagerTrap } from '../components/forms/PasswordManagerTrap';
import { ClientApiKeyInput, ClientSecretInput } from '../components/forms/NonLoginCredentialInput';
import { Badge } from '../components/ui/badge';
import { FieldError } from '../components/forms/FieldError';
import { MiddlewareStageBadge } from '../components/auth/MiddlewareStageBadge';
import {
  clearOneFieldError,
  failClientValidation,
  fieldInputErrorClass,
} from '../../lib/formValidation';
import {
  parseGatewayErrorBody,
  reasonLabel,
} from '../../lib/middlewareLabels';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  DATA_PLANE_PREFIX,
  describeProxyExpectation,
  looksLikeSpaShell,
  tryDataPlaneRequest,
  type ProxyTryResult,
} from '../../lib/proxyTry';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

const PROXY_TRY_CLIENT_KEY = 'proxy-try-client-id';

const PATH_SUGGESTIONS = [
  { label: 'Route mẫu', path: '/v1/api/get' },
  { label: 'SF limits', path: '/v1/api/sf/services/data/v59.0/limits' },
  { label: 'Zoho portals', path: '/v1/api/zoho/api/v3/portals' },
] as const;

function StatusBadge({ status }: { status: number }) {
  const tone =
    status === 401 || status === 403
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/40'
      : status === 429
        ? 'bg-orange-500/15 text-orange-400 border-orange-500/40'
        : status >= 200 && status < 300
          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
          : 'bg-destructive/15 text-destructive border-destructive/40';
  return (
    <Badge className={`${tone} border font-mono text-xs px-2.5 py-1`}>
      HTTP {status}
    </Badge>
  );
}

function ResultPanel({
  result,
  mode,
}: {
  result: ProxyTryResult | null;
  mode: 'no_token' | 'with_token' | null;
}) {
  if (!result || !mode) {
    return (
      <div className="min-h-[14rem] rounded-lg border border-dashed border-border/50 bg-slate-950/20 flex flex-col items-center justify-center p-6 text-center">
        <FlaskConical className="w-8 h-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground max-w-xs">Gửi request để xem kết quả.</p>
      </div>
    );
  }

  const hint = describeProxyExpectation(result, mode);
  const gwErr = parseGatewayErrorBody(result.bodyJson);
  const displayBody =
    result.bodyJson != null ? JSON.stringify(result.bodyJson, null, 2) : result.bodyText || '(body rỗng)';

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <StatusBadge status={result.status} />
        <MiddlewareStageBadge
          status={result.status}
          reason={gwErr?.error}
          outcome={result.ok ? 'success' : 'denied'}
          bodyJson={result.bodyJson}
        />
        <span className="text-xs text-muted-foreground font-mono min-w-0 break-all">
          {result.method} {result.requestUrl}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">{result.elapsedMs} ms</span>
      </div>
      {gwErr?.error ? (
        <p className="text-[11px] font-mono text-slate-500 break-words">
          error: <span className="text-slate-400">{gwErr.error}</span>
          {gwErr.message ? ` — ${gwErr.message}` : ''}
          <span className="text-muted-foreground ml-2">({reasonLabel(gwErr.error)})</span>
        </p>
      ) : null}
      <p className="text-sm text-foreground/90 rounded-lg bg-slate-900/50 border border-border/60 px-3 py-2 leading-relaxed break-words">
        {hint}
      </p>
      <pre className="max-h-80 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-slate-950/80 p-4 text-xs text-slate-200 font-mono whitespace-pre-wrap break-words">
        {displayBody}
      </pre>
    </div>
  );
}

export function ProxyTry() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [path, setPath] = useState('/v1/api/get');
  const [method, setMethod] = useState<string>('GET');
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProxyTryResult | null>(null);
  const [lastMode, setLastMode] = useState<'no_token' | 'with_token' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [registryClients, setRegistryClients] = useState<ClientKeyMeta[]>([]);
  const [pickedClientId, setPickedClientId] = useState('');
  useEffect(() => {
    void fetchClientKeys()
      .then((rows) => {
        const active = rows.filter((r) => r.status === 'active' && r.api_key);
        setRegistryClients(active);
        const fromUrl = searchParams.get('clientId');
        const fromStorage = localStorage.getItem(PROXY_TRY_CLIENT_KEY);
        const pickId = fromUrl || fromStorage || '';
        if (pickId) {
          const row = active.find((c) => String(c.id) === pickId);
          if (row?.api_key) {
            setPickedClientId(pickId);
            setApiKey(row.api_key);
          }
        }
      })
      .catch(() => setRegistryClients([]));
  }, [searchParams]);

  const onPickClient = (id: string) => {
    setPickedClientId(id);
    const row = registryClients.find((c) => String(c.id) === id);
    if (row?.api_key) {
      setApiKey(row.api_key);
      setSecretKey('');
    }
    if (id) {
      localStorage.setItem(PROXY_TRY_CLIENT_KEY, id);
      const next = new URLSearchParams(searchParams);
      next.set('clientId', id);
      setSearchParams(next, { replace: true });
    } else {
      localStorage.removeItem(PROXY_TRY_CLIENT_KEY);
      const next = new URLSearchParams(searchParams);
      next.delete('clientId');
      setSearchParams(next, { replace: true });
    }
  };

  const run = async (mode: 'no_token' | 'with_token') => {
    const nextErrors: Record<string, string> = {};
    if (mode === 'with_token' && !apiKey.trim()) {
      nextErrors.api_key = 'Nhập client_id từ Client Registry';
    }
    if (mode === 'with_token' && !secretKey.trim()) {
      nextErrors.secret_key = 'Nhập client_secret để lấy JWT';
    }
    if (Object.keys(nextErrors).length > 0) {
      failClientValidation(setFieldErrors, nextErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const res = await tryDataPlaneRequest({
        path,
        method,
        clientId: mode === 'with_token' ? apiKey : undefined,
        clientSecret: mode === 'with_token' ? secretKey : undefined,
      });
      setResult(res);
      setLastMode(mode);
      if (looksLikeSpaShell(res)) {
        toast.warning(`Path sai — cần ${DATA_PLANE_PREFIX}/...`);
      } else if (mode === 'with_token' && res.ok) {
        toast.success('Request qua middleware thành công');
      } else if (mode === 'no_token' && res.status === 401) {
        toast.message('Authentication từ chối khi thiếu Bearer token');
      } else if (res.status === 403) {
        toast.warning('Authorization — kiểm tra ACL / trạng thái client');
      } else if (res.status === 429) {
        toast.warning('Rate limit — giảm tần suất gọi');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-1">
          Data plane
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Thử gọi proxy</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 min-w-0">
        <div className="space-y-4 min-w-0">
          <Card className="border-border bg-card/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Route className="w-4 h-4 text-primary" />
                Request
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-foreground text-xs">Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger className="bg-input border-border text-foreground mt-1 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-foreground text-xs">Path</Label>
                  <PathAutocomplete
                    className="mt-1"
                    value={path}
                    presets={PATH_SUGGESTIONS}
                    placeholder="/v1/api/..."
                    hasError={Boolean(fieldErrors.path)}
                    onChange={(next) => {
                      setPath(next);
                      clearOneFieldError(setFieldErrors, 'path');
                    }}
                  />
                  <FieldError message={fieldErrors.path} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                OAuth2 client (JWT)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form autoComplete="off" onSubmit={(e) => e.preventDefault()} data-form-type="other">
                <PasswordManagerTrap />
                {registryClients.length > 0 ? (
                  <div className="mb-3">
                    <Label className="text-foreground text-xs">Chọn từ Client Registry</Label>
                    <select
                      className="mt-1 w-full h-9 rounded-md border border-border bg-input text-foreground text-xs px-2"
                      value={pickedClientId}
                      onChange={(e) => onPickClient(e.target.value)}
                    >
                      <option value="">— Chọn —</option>
                      {registryClients.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                          {c.allowed_route_ids.length > 0 ? ` (${c.allowed_route_ids.length} route ACL)` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div>
                  <Label className="text-foreground text-xs">API Key</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">
                    Lấy từ cột API Key trong Client Registry — tự điền khi chọn client ở trên.
                  </p>
                  <ClientApiKeyInput
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      clearOneFieldError(setFieldErrors, 'api_key');
                    }}
                    placeholder="avaso_pk_..."
                    className={fieldInputErrorClass(
                      Boolean(fieldErrors.api_key),
                      'mt-1 h-9 bg-input border-border font-mono text-xs',
                    )}
                  />
                  <FieldError message={fieldErrors.api_key} />
                </div>
                <div className="mt-3">
                  <Label className="text-foreground text-xs">Secret Key</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">
                    Chỉ hiện một lần lúc tạo client hoặc Rotate secret — hệ thống không lưu để xem lại.
                  </p>
                  <ClientSecretInput
                    value={secretKey}
                    onChange={(e) => {
                      setSecretKey(e.target.value);
                      clearOneFieldError(setFieldErrors, 'secret_key');
                    }}
                    placeholder="avaso_sk_..."
                    className={fieldInputErrorClass(
                      Boolean(fieldErrors.secret_key),
                      'mt-1 h-9 bg-input border-border font-mono text-xs',
                    )}
                  />
                  <FieldError message={fieldErrors.secret_key} />
                </div>

                <div className="flex flex-col gap-2 pt-4">
                  <Button
                    type="button"
                    disabled={busy}
                    className="w-full bg-primary hover:bg-primary/90 h-10"
                    onClick={() => void run('with_token')}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {busy ? 'Đang gửi qua middleware…' : 'Gửi có Bearer JWT'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    className="w-full text-muted-foreground hover:text-amber-400 h-9 text-xs"
                    onClick={() => void run('no_token')}
                  >
                    <ShieldAlert className="w-3.5 h-3.5 mr-2" />
                    Gửi không credential 
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border bg-card/80 lg:sticky lg:top-24 lg:self-start min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Play className="w-4 h-4 text-primary" />
              Kết quả middleware
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">
            <ResultPanel result={result} mode={lastMode} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
