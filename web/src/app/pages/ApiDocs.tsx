import { useState, type ReactNode } from 'react';
import { Card } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { Code, Globe, Server, AlertTriangle, Terminal } from 'lucide-react';
import { cn } from '../components/ui/utils';

type ApiDocTab = 'data-plane' | 'admin-api' | 'errors' | 'examples';

const TAB_CONFIG: Record<
  ApiDocTab,
  {
    label: string;
    short: string;
    description: string;
    icon: typeof Globe;
    listClass: string;
    triggerActive: string;
    frameClass: string;
    headerClass: string;
  }
> = {
  'data-plane': {
    label: 'Data Plane',
    short: 'Client / HMAC',
    description: 'Traffic qua gateway tới upstream — /v1/api/*, /health, HMAC client key.',
    icon: Globe,
    listClass: 'bg-slate-900/80 border-slate-700',
    triggerActive:
      'data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-200 data-[state=active]:border-blue-500/50 data-[state=active]:shadow-[0_0_12px_rgba(59,130,246,0.25)]',
    frameClass: 'border-blue-500/40 bg-blue-500/[0.06] shadow-[inset_0_1px_0_rgba(59,130,246,0.15)]',
    headerClass: 'from-blue-500/15 to-transparent border-blue-500/30',
  },
  'admin-api': {
    label: 'Admin API',
    short: 'Dashboard /api/*',
    description: 'Quản trị route, key, user, tích hợp — session cookie hoặc X-API-Key admin.',
    icon: Server,
    listClass: 'bg-slate-900/80 border-slate-700',
    triggerActive:
      'data-[state=active]:bg-primary/25 data-[state=active]:text-primary data-[state=active]:border-primary/60 data-[state=active]:shadow-[0_0_12px_rgba(249,115,22,0.3)]',
    frameClass: 'border-primary/45 bg-primary/[0.07] shadow-[inset_0_1px_0_rgba(249,115,22,0.2)]',
    headerClass: 'from-primary/20 to-transparent border-primary/35',
  },
  errors: {
    label: 'Error Codes',
    short: 'HTTP lỗi',
    description: 'Mã phản hồi chuẩn từ gateway và upstream.',
    icon: AlertTriangle,
    listClass: 'bg-slate-900/80 border-slate-700',
    triggerActive:
      'data-[state=active]:bg-red-500/20 data-[state=active]:text-red-200 data-[state=active]:border-red-500/50 data-[state=active]:shadow-[0_0_12px_rgba(239,68,68,0.2)]',
    frameClass: 'border-red-500/35 bg-red-500/[0.05] shadow-[inset_0_1px_0_rgba(239,68,68,0.12)]',
    headerClass: 'from-red-500/15 to-transparent border-red-500/30',
  },
  examples: {
    label: 'Examples',
    short: 'curl mẫu',
    description: 'Ví dụ gọi HMAC, login admin, list routes.',
    icon: Terminal,
    listClass: 'bg-slate-900/80 border-slate-700',
    triggerActive:
      'data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-200 data-[state=active]:border-emerald-500/50 data-[state=active]:shadow-[0_0_12px_rgba(16,185,129,0.2)]',
    frameClass: 'border-emerald-500/35 bg-emerald-500/[0.05] shadow-[inset_0_1px_0_rgba(16,185,129,0.12)]',
    headerClass: 'from-emerald-500/15 to-transparent border-emerald-500/30',
  },
};

function DocSectionFrame({
  tab,
  title,
  children,
}: {
  tab: ApiDocTab;
  title: string;
  children: ReactNode;
}) {
  const meta = TAB_CONFIG[tab];
  const Icon = meta.icon;
  return (
    <div className={cn('rounded-2xl border-2 p-1 transition-colors duration-200', meta.frameClass)}>
      <div
        className={cn(
          'flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-t-xl border-b bg-gradient-to-r',
          meta.headerClass
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-background/60 border border-border/80 shrink-0">
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Đang xem
              </span>
              <Badge variant="outline" className="font-semibold text-white border-border/80">
                {meta.label}
              </Badge>
            </div>
            <p className="text-sm text-slate-300 mt-0.5">{meta.description}</p>
          </div>
        </div>
      </div>
      <Card className="rounded-b-xl rounded-t-none border-0 bg-card/90 backdrop-blur-sm shadow-none">
        <div className="p-4 sm:p-6">
          <h3 className="text-lg font-bold text-white mb-4">{title}</h3>
          {children}
        </div>
      </Card>
    </div>
  );
}

export function ApiDocs() {
  const [activeTab, setActiveTab] = useState<ApiDocTab>('data-plane');
  const activeMeta = TAB_CONFIG[activeTab];
  const dataPlaneEndpoints = [
    {
      method: 'GET',
      path: '/health',
      description: 'Kiểm tra trạng thái gateway',
      auth: 'Không',
      response: '200 — {"status":"ok","service":"avaso-gateway","version":"0.1.0"}',
    },
    {
      method: 'GET',
      path: '/metrics',
      description: 'Metrics endpoint (stub JSON; chưa Prometheus text)',
      auth: 'Không (có thể tắt trong Settings)',
      response: '200 — JSON stub hoặc 404 nếu disabled',
    },
    {
      method: '*',
      path: '/v1/api/*',
      description: 'Data plane — proxy route + SF/Zoho integration paths',
      auth: 'HMAC: X-API-Key, X-Timestamp, X-Signature',
      response: 'Response từ upstream hoặc integration backend',
    },
    {
      method: '*',
      path: '/\{configured_route\}/*',
      description: 'Proxy theo route CRUD trên UI (prefix tùy cấu hình)',
      auth: 'HMAC (hoặc legacy X-API-Key nếu bật)',
      response: 'Response từ upstream',
    },
  ];

  const adminEndpoints = [
    { method: 'POST', path: '/api/login', description: 'Đăng nhập admin', auth: 'Không', body: '{"username":"admin","password":"***"}' },
    { method: 'POST', path: '/api/logout', description: 'Đăng xuất', auth: 'Session cookie', body: null },
    { method: 'GET', path: '/api/me', description: 'Thông tin user hiện tại', auth: 'Session / X-API-Key admin', body: null },
    { method: 'GET', path: '/api/routes', description: 'Danh sách routes', auth: 'Viewer+', body: null },
    { method: 'POST', path: '/api/routes', description: 'Tạo route', auth: 'Admin', body: '{"path":"/v1/api/foo","target":"https://...","timeout_secs":30}' },
    { method: 'PUT', path: '/api/routes/{id}', description: 'Cập nhật route', auth: 'Operator+', body: 'RouteWriteBody' },
    { method: 'DELETE', path: '/api/routes/{id}', description: 'Xóa route', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/client-keys', description: 'Danh sách API key (metadata)', auth: 'Viewer+', body: null },
    { method: 'POST', path: '/api/client-keys', description: 'Tạo client key HMAC', auth: 'Operator+', body: '{"name":"app-name"}' },
    { method: 'POST', path: '/api/client-keys/encrypted', description: 'Tạo key qua RSA envelope', auth: 'Operator+', body: 'CryptoEnvelope JSON' },
    { method: 'DELETE', path: '/api/client-keys/{id}', description: 'Revoke key', auth: 'Operator+', body: null },
    { method: 'GET', path: '/api/users', description: 'Danh sách admin users', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/users', description: 'Tạo user', auth: 'Admin', body: '{"username":"...","password":"***","role":"operator"}' },
    { method: 'PUT', path: '/api/users/{id}', description: 'Cập nhật user', auth: 'Admin', body: null },
    { method: 'DELETE', path: '/api/users/{id}', description: 'Xóa user', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/audit-logs', description: 'Audit log admin', auth: 'Viewer+', body: '?limit=&result=&search=' },
    { method: 'GET', path: '/api/transaction-logs', description: 'Transaction log gateway', auth: 'Viewer+', body: '?limit=&method=&status=&search=' },
    { method: 'GET', path: '/api/proxy-queue', description: 'DLQ in-memory', auth: 'Viewer+', body: null },
    { method: 'POST', path: '/api/proxy-queue/{id}/retry', description: 'Retry queued request', auth: 'Operator+', body: null },
    { method: 'GET', path: '/api/settings', description: 'Runtime settings', auth: 'Viewer+', body: null },
    { method: 'PUT', path: '/api/settings', description: 'Cập nhật settings', auth: 'Admin', body: 'GatewaySettingsWriteBody' },
    { method: 'GET', path: '/api/dashboard/stats', description: 'Thống kê Overview', auth: 'Viewer+ (session)', body: null },
    { method: 'GET', path: '/api/proxy', description: 'Demo upstream JSONPlaceholder (không phải gateway logic)', auth: 'Viewer+', body: null },
    { method: 'GET', path: '/api/integrations', description: 'Trạng thái SF/Zoho', auth: 'Viewer+', body: null },
    { method: 'GET', path: '/api/integrations/salesforce/connect', description: 'Bắt đầu OAuth SF', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/salesforce/sync', description: 'Sync snapshot SF', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/zoho/connect', description: 'Bắt đầu OAuth Zoho', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/zoho/sync', description: 'Sync snapshot Zoho', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/reload-config', description: 'Reload routes từ DB', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/crypto/public-key', description: 'RSA public key gateway', auth: 'Không', body: null },
  ];

  const errorCodes = [
    { code: '401', description: 'Unauthorized — thiếu/sai session, admin key, hoặc HMAC client' },
    { code: '403', description: 'Forbidden — RBAC hoặc tenant route mismatch' },
    { code: '404', description: 'Not Found — route/upstream không tồn tại' },
    { code: '429', description: 'Too Many Requests — rate limit' },
    { code: '502', description: 'Bad Gateway — upstream lỗi' },
    { code: '504', description: 'Gateway Timeout' },
    { code: '500', description: 'Internal Server Error' },
  ];

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      POST: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      PUT: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      DELETE: 'bg-red-500/10 text-red-400 border-red-500/20',
      '*': 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    };
    return colors[method] || colors['*'];
  };

  return (
    <>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Tài liệu API</h1>
        <p className="text-muted-foreground">
          Admin API mount tại <code className="text-primary">/api/*</code> — session cookie hoặc header{' '}
          <code className="text-primary">X-API-Key</code> (admin).
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ApiDocTab)}
        className="space-y-4"
      >
        <TabsList
          className={cn(
            'w-full h-auto grid grid-cols-2 sm:flex sm:flex-wrap gap-2 p-2 rounded-xl border',
            activeMeta.listClass
          )}
        >
          {(Object.keys(TAB_CONFIG) as ApiDocTab[]).map((key) => {
            const m = TAB_CONFIG[key];
            return (
              <TabsTrigger
                key={key}
                value={key}
                className={cn(
                  'flex-1 min-h-[44px] px-3 py-2.5 text-sm font-semibold rounded-lg border border-transparent',
                  'text-muted-foreground transition-all',
                  m.triggerActive
                )}
              >
                <span className="flex flex-col items-center sm:items-start gap-0.5">
                  <span>{m.label}</span>
                  <span className="text-[10px] font-normal opacity-80 hidden sm:inline">{m.short}</span>
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="data-plane" className="mt-0 focus-visible:outline-none">
          <DocSectionFrame tab="data-plane" title="Endpoints — Data Plane">
            <div className="space-y-4">
              {dataPlaneEndpoints.map((endpoint, index) => (
                <div key={index} className="p-4 rounded-lg bg-background/50 border border-border">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <Badge className={`${getMethodColor(endpoint.method)} border font-mono`}>
                      {endpoint.method}
                    </Badge>
                    <code className="text-sm text-slate-300 font-mono">{endpoint.path}</code>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{endpoint.description}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Auth: </span>
                      <span className="text-slate-300">{endpoint.auth}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Response: </span>
                      <span className="text-slate-300">{endpoint.response}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </DocSectionFrame>
        </TabsContent>

        <TabsContent value="admin-api" className="mt-0 focus-visible:outline-none">
          <DocSectionFrame tab="admin-api" title="Endpoints — Admin API">
            <div className="space-y-3 max-h-[min(640px,60vh)] overflow-y-auto pr-1">
              {adminEndpoints.map((endpoint, index) => (
                <div key={index} className="p-4 rounded-lg bg-background/50 border border-border">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <Badge className={`${getMethodColor(endpoint.method)} border font-mono`}>
                      {endpoint.method}
                    </Badge>
                    <code className="text-sm text-slate-300 font-mono">{endpoint.path}</code>
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">{endpoint.description}</p>
                  <div className="text-xs space-y-1">
                    <div>
                      <span className="text-muted-foreground">Auth: </span>
                      <span className="text-amber-400">{endpoint.auth}</span>
                    </div>
                    {endpoint.body && (
                      <div>
                        <span className="text-muted-foreground">Body/query: </span>
                        <code className="text-slate-300 text-xs">{endpoint.body}</code>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </DocSectionFrame>
        </TabsContent>

        <TabsContent value="errors" className="mt-0 focus-visible:outline-none">
          <DocSectionFrame tab="errors" title="HTTP Error Codes">
            <div className="space-y-3">
              {errorCodes.map((error) => (
                <div key={error.code} className="flex items-start gap-4 p-3 rounded-lg bg-background/50 border border-border">
                  <Badge className="bg-red-500/10 text-red-400 border-red-500/20 border font-mono min-w-[60px] justify-center">
                    {error.code}
                  </Badge>
                  <p className="text-sm text-slate-300">{error.description}</p>
                </div>
              ))}
            </div>
          </DocSectionFrame>
        </TabsContent>

        <TabsContent value="examples" className="mt-0 focus-visible:outline-none">
          <DocSectionFrame tab="examples" title="Ví dụ curl">
            <div className="grid gap-6">
            <div className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
              <h4 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <Code className="w-5 h-5 text-emerald-400" />
                HMAC data-plane request
              </h4>
              <div className="bg-background/80 rounded-lg p-4 font-mono text-xs overflow-x-auto">
                <pre className="text-slate-300">{`# Ký payload: api_key\\ntimestamp\\nMETHOD\\npath?query\\nbody
curl -X GET "https://thientinh.io.vn/v1/api/get" \\
  -H "X-API-Key: avaso_pk_..." \\
  -H "X-Timestamp: $(date +%s)" \\
  -H "X-Signature: <hmac_sha256_hex>"`}</pre>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
              <h4 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                Admin login
              </h4>
              <div className="bg-background/80 rounded-lg p-4 font-mono text-xs overflow-x-auto">
                <pre className="text-slate-300">{`curl -X POST https://thientinh.io.vn/api/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"***"}' \\
  -c cookies.txt

# Response: {"status":"ok","username":"admin","role":"admin",...}`}</pre>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
              <h4 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                List routes (session)
              </h4>
              <div className="bg-background/80 rounded-lg p-4 font-mono text-xs overflow-x-auto">
                <pre className="text-slate-300">{`curl https://thientinh.io.vn/api/routes -b cookies.txt

# Hoặc admin key:
curl https://thientinh.io.vn/api/routes -H "X-API-Key: <admin_key>"`}</pre>
              </div>
            </div>
            </div>
          </DocSectionFrame>
        </TabsContent>
      </Tabs>
    </>
  );
}
