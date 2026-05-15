import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Play, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { describeProxyExpectation, tryDataPlaneRequest, type ProxyTryResult } from '../../lib/proxyTry';
import { getTestClientKey, setTestClientKey } from '../../lib/proxyTryStorage';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

function StatusBadge({ status }: { status: number }) {
  const tone =
    status === 401
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/40'
      : status >= 200 && status < 300
        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
        : 'bg-destructive/15 text-destructive border-destructive/40';
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-sm font-semibold ${tone}`}>
      HTTP {status}
    </span>
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
    return (
      <p className="text-sm text-muted-foreground">
        Chưa có kết quả. Dùng một trong hai nút bên trên để gửi request.
      </p>
    );
  }

  const hint = describeProxyExpectation(result, mode);
  const displayBody =
    result.bodyJson != null ? JSON.stringify(result.bodyJson, null, 2) : result.bodyText || '(body rỗng)';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={result.status} />
        <span className="text-xs text-muted-foreground">
          {result.method} {result.requestUrl} · {result.elapsedMs} ms
          {result.sentApiKey ? ' · có X-API-Key' : ' · không X-API-Key'}
        </span>
      </div>
      <p className="text-sm text-foreground/90">{hint}</p>
      <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-slate-950/80 p-4 text-xs text-slate-200 font-mono">
        {displayBody}
      </pre>
    </div>
  );
}

export function ProxyTry() {
  const [path, setPath] = useState('/v1/api/get');
  const [method, setMethod] = useState<string>('GET');
  const [clientKey, setClientKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProxyTryResult | null>(null);
  const [lastMode, setLastMode] = useState<'no_key' | 'with_key' | null>(null);

  useEffect(() => {
    setClientKey(getTestClientKey());
  }, []);

  const run = async (mode: 'no_key' | 'with_key') => {
    if (mode === 'with_key' && !clientKey.trim()) {
      toast.error('Dán client API key (avaso_...) hoặc tạo key ở Bảo mật & Auth.');
      return;
    }
    setBusy(true);
    try {
      const res = await tryDataPlaneRequest({
        path,
        method,
        apiKey: mode === 'with_key' ? clientKey : undefined,
      });
      setResult(res);
      setLastMode(mode);
      if (mode === 'no_key' && res.status === 401) {
        toast.success('401 — Từ chối dịch vụ vì thiếu Key API.');
      } else if (mode === 'with_key' && res.ok) {
        toast.success('Request thành công qua gateway.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveKeyForTab = () => {
    if (!clientKey.trim()) {
      toast.error('Nhập key trước khi lưu.');
      return;
    }
    setTestClientKey(clientKey.trim());
    toast.success('Đã lưu key trong tab (sessionStorage) cho lần thử sau.');
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Thử gọi Proxy (Data plane)</h1>
        <p className="text-muted-foreground max-w-2xl">
          Gửi request qua gateway giống client thật — không cần terminal. Prefix mặc định{' '}
          <code className="text-primary text-sm">/v1/api</code>; cần route khớp trên Quản lý Route.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card/80">
          <CardHeader>
            <CardTitle className="text-white">Cấu hình request</CardTitle>
            <CardDescription>Path tương đối cùng domain (vd thientinh.io.vn).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <Label className="text-foreground">Method</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="bg-input border-border text-foreground mt-1">
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
                <Label className="text-foreground">Path</Label>
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/v1/api/get"
                  className="mt-1 bg-input border-border text-foreground"
                />
              </div>
            </div>
            <div>
              <Label className="text-foreground">Client X-API-Key (avaso_...)</Label>
              <Input
                type="password"
                value={clientKey}
                onChange={(e) => setClientKey(e.target.value)}
                placeholder="Chỉ dùng khi bấm Gửi có key"
                className="mt-1 bg-input border-border text-foreground"
                autoComplete="off"
              />
              <div className="mt-2 flex gap-2">
                <Button type="button" variant="outline" size="sm" className="border-border" onClick={saveKeyForTab}>
                  Lưu key trong tab
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => {
                    setTestClientKey(null);
                    setClientKey('');
                    toast.message('Đã xóa key khỏi tab.');
                  }}
                >
                  Xóa key đã lưu
                </Button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                className="flex-1 border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                onClick={() => void run('no_key')}
              >
                <ShieldAlert className="w-4 h-4 mr-2" />
                Gửi không API Key
              </Button>
              <Button
                type="button"
                disabled={busy}
                className="flex-1 bg-primary hover:bg-primary/90"
                onClick={() => void run('with_key')}
              >
                <ShieldCheck className="w-4 h-4 mr-2" />
                Gửi có API Key
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card/80">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Play className="w-5 h-5 text-primary" />
              Kết quả
            </CardTitle>
            <CardDescription>So sánh 401 (không key) và 200 (có key hợp lệ).</CardDescription>
          </CardHeader>
          <CardContent>
            <ResultPanel result={result} mode={lastMode} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
