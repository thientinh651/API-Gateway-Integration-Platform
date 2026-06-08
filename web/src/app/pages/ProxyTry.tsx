import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Play, Route, Send, ShieldAlert } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { PathAutocomplete } from '../components/forms/PathAutocomplete';
import { PasswordManagerTrap } from '../components/forms/PasswordManagerTrap';
import { ClientApiKeyInput, ClientSecretInput } from '../components/forms/NonLoginCredentialInput';
import { Badge } from '../components/ui/badge';
import { FieldError } from '../components/forms/FieldError';
import {
  clearOneFieldError,
  failClientValidation,
  fieldInputErrorClass,
} from '../../lib/formValidation';
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

const PATH_SUGGESTIONS = [
  { label: 'GET mẫu', path: '/v1/api/get' },
  { label: 'SF limits', path: '/v1/api/sf/limits' },
  { label: 'Zoho portals', path: '/v1/api/zoho/api/v3/portals' },
] as const;

function StatusBadge({ status }: { status: number }) {
  const tone =
    status === 401
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/40'
      : status >= 200 && status < 300
        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
        : 'bg-destructive/15 text-destructive border-destructive/40';
  const label = status === 401 ? 'Từ chối' : status >= 200 && status < 300 ? 'Thành công' : 'Lỗi';
  return (
    <Badge className={`${tone} border font-mono text-xs px-2.5 py-1`}>
      {label} · HTTP {status}
    </Badge>
  );
}

function ResultPanel({
  result,
  mode,
}: {
  result: ProxyTryResult | null;
  mode: 'no_key' | 'with_key' | null;
}) {
  if (!result || !mode) {
    return <div className="min-h-[12rem] rounded-lg border border-border/40 bg-slate-950/20" />;
  }

  const hint = describeProxyExpectation(result, mode);
  const displayBody =
    result.bodyJson != null ? JSON.stringify(result.bodyJson, null, 2) : result.bodyText || '(body rỗng)';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={result.status} />
        <span className="text-xs text-muted-foreground font-mono">
          {result.method} {result.requestUrl}
        </span>
        <span className="text-xs text-muted-foreground">{result.elapsedMs} ms</span>
      </div>
      <p className="text-sm text-foreground/90 rounded-lg bg-slate-900/50 border border-border/60 px-3 py-2">
        {hint}
      </p>
      <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-slate-950/80 p-4 text-xs text-slate-200 font-mono">
        {displayBody}
      </pre>
    </div>
  );
}

export function ProxyTry() {
  const [path, setPath] = useState('/v1/api/get');
  const [method, setMethod] = useState<string>('GET');
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProxyTryResult | null>(null);
  const [lastMode, setLastMode] = useState<'no_key' | 'with_key' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const run = async (mode: 'no_key' | 'with_key') => {
    const nextErrors: Record<string, string> = {};
    if (mode === 'with_key' && !apiKey.trim()) {
      nextErrors.api_key = 'Nhập API Key';
    }
    if (mode === 'with_key' && apiKey.startsWith('avaso_pk_') && !secretKey.trim()) {
      nextErrors.secret_key = 'Nhập Secret Key';
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
        apiKey: mode === 'with_key' ? apiKey : undefined,
        secretKey: mode === 'with_key' ? secretKey : undefined,
      });
      setResult(res);
      setLastMode(mode);
      if (looksLikeSpaShell(res)) {
        toast.warning(`Path sai — cần bắt đầu ${DATA_PLANE_PREFIX}/`);
      } else if (mode === 'with_key' && res.ok) {
        toast.success('Gateway chấp nhận key và forward request');
      } else if (mode === 'no_key' && res.status === 401) {
        toast.message('Đúng: gateway từ chối khi thiếu key');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="text-2xl sm:text-3xl font-bold text-white mb-6">Thử gọi Proxy</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
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
                <KeyRound className="w-4 h-4 text-primary" />
                Credential
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form autoComplete="off" onSubmit={(e) => e.preventDefault()} data-form-type="other">
                <PasswordManagerTrap />
                <div>
                  <Label className="text-foreground text-xs">API Key</Label>
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
                    onClick={() => void run('with_key')}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {busy ? 'Đang gửi…' : 'Gửi request'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    className="w-full text-muted-foreground hover:text-amber-400 h-9 text-xs"
                    onClick={() => void run('no_key')}
                  >
                    <ShieldAlert className="w-3.5 h-3.5 mr-2" />
                    Không key (401)
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border bg-card/80 lg:sticky lg:top-24 lg:self-start">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Play className="w-4 h-4 text-primary" />
              Kết quả
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResultPanel result={result} mode={lastMode} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
