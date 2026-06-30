import { useState, type ReactNode } from 'react';
import { Card } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { Code, Globe, Server, AlertTriangle, Terminal } from 'lucide-react';
import { cn } from '../components/ui/utils';
import { TechPageHeader } from '../components/tech/TechPageHeader';
import { ApiEndpointCard } from '../components/tech/ApiEndpointCard';
import { MiddlewarePipelineBanner } from '../components/auth/MiddlewarePipelineBanner';

type ApiDocTab = 'data-plane' | 'admin-api' | 'errors' | 'examples';

const TAB_CONFIG: Record<
  ApiDocTab,
  {
    label: string;
    short: string;
    description: string;
    icon: typeof Globe;
    frameClass: string;
    headerClass: string;
  }
> = {
  'data-plane': {
    label: 'Data plane (middleware)',
    short: 'Middleware',
    description:
      'API Gateway — JWT validation, routing engine, rate limit, transform, logging trên prefix /v1/api/*.',
    icon: Globe,
    frameClass: 'border-blue-500/40 bg-blue-500/[0.06] shadow-[inset_0_1px_0_rgba(59,130,246,0.15)]',
    headerClass: 'from-blue-500/15 to-transparent border-blue-500/30',
  },
  'admin-api': {
    label: 'Quản trị trên dashboard',
    short: 'Admin',
    description:
      'Cấu hình client, route, user, audit, Salesforce/Zoho.',
    icon: Server,
    frameClass: 'border-primary/45 bg-primary/[0.07] shadow-[inset_0_1px_0_rgba(249,115,22,0.2)]',
    headerClass: 'from-primary/20 to-transparent border-primary/35',
  },
  errors: {
    label: 'Error Codes',
    short: 'HTTP lỗi',
    description: 'Mã phản hồi chuẩn từ gateway và upstream.',
    icon: AlertTriangle,
    frameClass: 'border-red-500/35 bg-red-500/[0.05] shadow-[inset_0_1px_0_rgba(239,68,68,0.12)]',
    headerClass: 'from-red-500/15 to-transparent border-red-500/30',
  },
  examples: {
    label: 'Examples',
    short: 'curl mẫu',
    description: 'Ví dụ OAuth2 token, Bearer JWT, routing, login admin.',
    icon: Terminal,
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
              <Badge variant="outline" className="font-semibold text-white border-border/80 font-mono-tech">
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

/** Thanh tab kiểu segmented control — tab chọn có nền pill nổi trong track. */
const TAB_TRACK =
  'w-full h-auto grid grid-cols-2 sm:grid-cols-4 gap-1 p-1.5 rounded-xl bg-slate-900/95 border border-slate-700/90';
const TAB_PILL_IDLE =
  'bg-transparent text-slate-400 hover:text-slate-200 border-0 shadow-none';
const TAB_PILL_ACTIVE =
  'bg-slate-600 text-white shadow-[0_2px_10px_rgba(0,0,0,0.45)] border border-slate-500/80';

export function ApiDocs() {
  const [activeTab, setActiveTab] = useState<ApiDocTab>('data-plane');
  const dataPlaneEndpoints = [
    {
      method: 'POST',
      path: '/oauth/token',
      description: 'Identity — phát access_token (password | client_credentials | authorization_code). Rate limit: 20/phút/client_id, 50/phút/IP (burst ≤3)',
      auth: 'Không (public token endpoint)',
      response: '{"access_token":"eyJ...","token_type":"Bearer","expires_in":3600}',
    },
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
      method: 'GET',
      path: '/v1/api/canonical/contacts',
      description: 'Danh sách contact — canonical JSON (query target=sf|zoho)',
      auth: 'Bearer JWT',
      response: '{"entity":"contact","format":"canonical","data":[...]}',
    },
    {
      method: 'POST',
      path: '/v1/api/canonical/contacts',
      description: 'Tạo contact — body canonical, target=sf|zoho',
      auth: 'Bearer JWT',
      response: 'Canonical record sau transform',
    },
    {
      method: '*',
      path: '/v1/api/*',
      description: 'Routing engine — longest prefix match → proxy upstream (SF/Zoho/product API)',
      auth: 'Authorization: Bearer <JWT>',
      response: 'Response từ upstream qua gateway',
    },
    {
      method: '*',
      path: '/\{configured_route\}/*',
      description: 'Route CRUD trên dashboard — prefix tùy cấu hình',
      auth: 'Bearer JWT',
      response: 'Response từ upstream',
    },
  ];

  const adminEndpoints = [
    { method: 'POST', path: '/api/login', description: 'Đăng nhập admin', auth: 'Không', body: '{"username":"admin","password":"***"}' },
    { method: 'POST', path: '/api/register', description: 'Đăng ký Viewer (ALLOW_VIEWER_REGISTRATION=1)', auth: 'Không', body: '{"username":"...","email":"...","password":"***"}' },
    { method: 'POST', path: '/api/logout', description: 'Đăng xuất', auth: 'Session cookie', body: null },
    { method: 'GET', path: '/api/me', description: 'Thông tin user hiện tại', auth: 'Session', body: null },
    { method: 'PUT', path: '/api/me', description: 'Cập nhật hồ sơ (username/email/mật khẩu)', auth: 'Mọi role (session)', body: '{"username":"?","email":"?","password":"?","current_password":"*"}' },
    { method: 'POST', path: '/api/forgot-password', description: 'Xác minh username+email, gửi OTP', auth: 'Không', body: '{"username":"...","email":"..."}' },
    { method: 'POST', path: '/api/verify-reset-otp', description: 'Xác minh OTP (bước 2)', auth: 'Không', body: '{"username":"...","otp":"123456"}' },
    { method: 'POST', path: '/api/reset-password', description: 'Đặt mật khẩu mới (bước 3)', auth: 'Không', body: '{"reset_token":"...","password":"***"}' },
    { method: 'GET', path: '/api/routes', description: 'Danh sách routes', auth: 'Viewer+', body: null },
    { method: 'POST', path: '/api/routes', description: 'Tạo route', auth: 'Admin', body: '{"path":"/v1/api/foo","target":"https://...","timeout_secs":30}' },
    { method: 'PUT', path: '/api/routes/{id}', description: 'Cập nhật route', auth: 'Operator+', body: 'RouteWriteBody' },
    { method: 'DELETE', path: '/api/routes/{id}', description: 'Xóa route', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/client-keys', description: 'Client Registry — danh sách client', auth: 'Operator+', body: null },
    { method: 'POST', path: '/api/client-keys', description: 'Đăng ký OAuth2 client (client_id + client_secret)', auth: 'Operator+', body: '{"name":"web-shop","integration_type":"app","rate_limit_per_min":100}' },
    { method: 'PATCH', path: '/api/client-keys/{id}', description: 'Cập nhật status / rate limit', auth: 'Operator+', body: '{"status":"disabled","rate_limit_per_min":200}' },
    { method: 'POST', path: '/api/client-keys/bulk-status', description: 'Bật/tắt nhiều client', auth: 'Operator+', body: '{"ids":[1,2],"status":"disabled"}' },
    { method: 'PUT', path: '/api/client-keys/{id}/routes', description: 'ACL route cho client', auth: 'Operator+', body: '{"route_ids":[1,2]}' },
    { method: 'GET', path: '/api/client-keys/traffic-summary', description: 'Tổng request 24h theo client (batch)', auth: 'Operator+', body: null },
    { method: 'GET', path: '/api/client-keys/{id}/traffic', description: 'Thống kê traffic 24h theo client', auth: 'Operator+', body: '?hours=24' },
    { method: 'POST', path: '/api/client-keys/{id}/rotate', description: 'Rotate client_secret (client_id giữ nguyên)', auth: 'Operator+', body: null },
    { method: 'POST', path: '/api/client-keys/{id}/revoke-tokens', description: 'Thu hồi mọi JWT của client (tăng token_version)', auth: 'Operator+', body: null },
    { method: 'GET', path: '/api/oauth/tokens', description: 'Audit JWT đang live / lịch sử', auth: 'Operator+', body: '?active_only=true&limit=100' },
    { method: 'POST', path: '/api/oauth/tokens/revoke', description: 'Thu hồi một JWT theo jti', auth: 'Operator+', body: '{"jti":"uuid"}' },
    { method: 'POST', path: '/api/oauth/revoke', description: 'RFC 7009 — thu hồi theo raw access_token', auth: 'Không', body: 'token=eyJ...' },
    { method: 'POST', path: '/api/oauth/logout', description: 'Thu hồi Bearer token đang gửi', auth: 'Bearer JWT', body: null },
    { method: 'GET', path: '/api/oauth/apps', description: 'App OAuth bên thứ 3 (Authorization Code)', auth: 'Operator+', body: null },
    { method: 'POST', path: '/api/oauth/apps', description: 'Đăng ký app + redirect_uris', auth: 'Admin', body: '{"name":"Partner","redirect_uris":["https://..."],"with_secret":true}' },
    { method: 'GET', path: '/oauth/authorize', description: 'Consent + authorization code (PKCE S256 required)', auth: 'Session dashboard', body: '?client_id&redirect_uri&response_type=code&code_challenge&code_challenge_method=S256&state' },
    { method: 'POST', path: '/api/client-keys/encrypted', description: 'Đăng ký qua RSA envelope', auth: 'Operator+', body: 'CryptoEnvelope JSON' },
    { method: 'DELETE', path: '/api/client-keys/{id}', description: 'Xóa client khỏi registry', auth: 'Operator+', body: null },
    { method: 'GET', path: '/api/users', description: 'Danh sách admin users', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/users', description: 'Tạo user', auth: 'Admin', body: '{"username":"...","password":"***","role":"operator"}' },
    { method: 'PUT', path: '/api/users/{id}', description: 'Cập nhật user', auth: 'Admin', body: null },
    { method: 'DELETE', path: '/api/users/{id}', description: 'Xóa user', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/audit-logs', description: 'Audit log admin', auth: 'Viewer+', body: '?limit=&result=&search=' },
    { method: 'GET', path: '/api/transaction-logs', description: 'Transaction log gateway', auth: 'Viewer+', body: '?limit=&method=&status=&outcome=&reason=&client_key_id=&search=' },
    { method: 'GET', path: '/api/proxy-queue', description: 'DLQ PostgreSQL (persistent)', auth: 'Viewer+', body: null },
    { method: 'POST', path: '/api/proxy-queue/{id}/retry', description: 'Retry queued request (manual)', auth: 'Operator+', body: null },
    { method: 'GET', path: '/api/integrations', description: 'Trạng thái SF/Zoho', auth: 'Admin', body: null },
    { method: 'PUT', path: '/api/settings', description: 'Cập nhật settings', auth: 'Admin', body: 'GatewaySettingsWriteBody' },
    { method: 'GET', path: '/api/middleware/status', description: 'Trạng thái runtime middleware (clients, routes, RL)', auth: 'Viewer+', body: null },
    { method: 'GET', path: '/api/dashboard/stats', description: 'Thống kê Overview', auth: 'Viewer+ (session)', body: null },
    { method: 'GET', path: '/api/proxy', description: 'Demo upstream JSONPlaceholder (không phải gateway logic)', auth: 'Viewer+', body: null },
    { method: 'GET', path: '/api/integrations', description: 'Trạng thái SF/Zoho', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/salesforce/connect', description: 'Bắt đầu OAuth SF', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/salesforce/sync', description: 'Sync snapshot SF', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/zoho/connect', description: 'Bắt đầu OAuth Zoho', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/zoho/sync', description: 'Sync snapshot Zoho', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/sync-now', description: 'Pipeline SF→Zoho (pull + lọc + push + log)', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/pipeline-status', description: 'Trạng thái 4 bước pipeline', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/entity-links', description: 'Mapping Opportunity↔Project', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/sync-logs', description: 'Sync log middleware', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/snapshots', description: 'Snapshot pull về DB', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/reset-sync', description: 'Xóa entity links cũ', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/reload-config', description: 'Reload routes từ DB', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/crypto/public-key', description: 'RSA public key của gateway (envelope đăng ký client — không phải client_id avaso_pk_)', auth: 'Không', body: null },
  ];

  const errorCodes = [
    { code: '401', description: 'JWT validation — thiếu/sai/hết hạn Bearer token' },
    { code: '403', description: 'Authorization — client disabled, ACL route, hoặc RBAC admin' },
    { code: '404', description: 'Routing — không có route khớp path' },
    { code: '429', description: 'Rate limiting — vượt quota client / route / global' },
    { code: '502', description: 'Upstream — middleware đã cho qua nhưng backend lỗi' },
    { code: '504', description: 'Gateway Timeout' },
    { code: '500', description: 'Internal Server Error' },
  ];

  const middlewareErrorFields = [
    { field: 'missing_token', description: 'Thiếu header Authorization: Bearer' },
    { field: 'invalid_token', description: 'JWT sai chữ ký, issuer hoặc format' },
    { field: 'token_expired', description: 'JWT hết hạn (exp claim)' },
    { field: 'client_key_disabled', description: 'OAuth client status = disabled' },
    { field: 'route_forbidden', description: 'Path không nằm trong ACL của client' },
    { field: 'rate_limit_exceeded', description: 'Token bucket hết (data plane hoặc POST /oauth/token) — xem Retry-After' },
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
      <TechPageHeader
        codeLine="// danh sách endpoint"
        title="Tài liệu API"
        description={
          <>
            API Gateway Rust — JWT identity, routing engine, admin control plane.
          </>
        }
      />

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ApiDocTab)}
        className="space-y-4"
      >
        <TabsList className={cn(TAB_TRACK, 'bg-muted/0')}>
          {(Object.keys(TAB_CONFIG) as ApiDocTab[]).map((key) => {
            const m = TAB_CONFIG[key];
            const selected = activeTab === key;
            return (
              <TabsTrigger
                key={key}
                value={key}
                className={cn(
                  'min-h-[42px] px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200',
                  'data-[state=active]:bg-transparent data-[state=active]:text-inherit data-[state=active]:shadow-none',
                  'dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-inherit',
                  selected ? TAB_PILL_ACTIVE : TAB_PILL_IDLE
                )}
              >
                {m.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="data-plane" className="mt-0 focus-visible:outline-none space-y-4">
          <MiddlewarePipelineBanner compact />
          <DocSectionFrame tab="data-plane" title="Endpoint data plane">
            <div className="space-y-4">
              {dataPlaneEndpoints.map((endpoint, index) => (
                <ApiEndpointCard
                  key={index}
                  method={endpoint.method}
                  path={endpoint.path}
                  description={endpoint.description}
                  methodColorClass={getMethodColor(endpoint.method)}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono-tech">
                    <div>
                      <span className="text-muted-foreground">auth → </span>
                      <span className="text-slate-300">{endpoint.auth}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">res → </span>
                      <span className="text-slate-300">{endpoint.response}</span>
                    </div>
                  </div>
                </ApiEndpointCard>
              ))}
            </div>
          </DocSectionFrame>
        </TabsContent>

        <TabsContent value="admin-api" className="mt-0 focus-visible:outline-none">
          <DocSectionFrame tab="admin-api" title="Endpoint quản trị (dashboard)">
            <div className="space-y-3">
              {adminEndpoints.map((endpoint, index) => (
                <ApiEndpointCard
                  key={index}
                  method={endpoint.method}
                  path={endpoint.path}
                  description={endpoint.description}
                  methodColorClass={getMethodColor(endpoint.method)}
                >
                  <div className="text-xs space-y-1 font-mono-tech">
                    <div>
                      <span className="text-muted-foreground">auth → </span>
                      <span className="text-amber-400">{endpoint.auth}</span>
                    </div>
                    {endpoint.body && (
                      <div>
                        <span className="text-muted-foreground">body → </span>
                        <code className="text-slate-300 text-xs">{endpoint.body}</code>
                      </div>
                    )}
                  </div>
                </ApiEndpointCard>
              ))}
            </div>
          </DocSectionFrame>
        </TabsContent>

        <TabsContent value="errors" className="mt-0 focus-visible:outline-none space-y-4">
          <DocSectionFrame tab="errors" title="HTTP status">
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
          <DocSectionFrame tab="errors" title="JSON error (data plane)">
            <div className="space-y-3">
              {middlewareErrorFields.map((row) => (
                <div key={row.field} className="flex items-start gap-4 p-3 rounded-lg bg-background/50 border border-border">
                  <Badge variant="outline" className="font-mono text-[10px] text-amber-400 border-amber-500/30 shrink-0">
                    {row.field}
                  </Badge>
                  <p className="text-sm text-slate-300">{row.description}</p>
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
                <Code className="w-5 h-5 text-sky-400" />
                Client Registry + ACL
              </h4>
              <div className="bg-[#050810] rounded-lg p-4 font-mono-tech text-xs overflow-x-auto border border-border/80 shadow-inner">
                <pre className="text-slate-300">{`curl -X POST https://thientinh.io.vn/api/client-keys \\
  -b cookies.txt -H "Content-Type: application/json" \\
  -d '{"name":"erp","rate_limit_per_min":100}'

curl -X PUT https://thientinh.io.vn/api/client-keys/1/routes \\
  -b cookies.txt -H "Content-Type: application/json" \\
  -d '{"route_ids":[1]}'`}</pre>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
              <h4 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <Code className="w-5 h-5 text-emerald-400" />
                OAuth2 token + JWT data-plane
              </h4>
              <div className="bg-[#050810] rounded-lg p-4 font-mono-tech text-xs overflow-x-auto border border-border/80 shadow-inner">
                <pre className="text-slate-300">{`# 1) Lấy JWT (client_id + client_secret — CHỈ tại token endpoint)
curl -sS -X POST https://thientinh.io.vn/api/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials&client_id=avaso_pk_...&client_secret=avaso_sk_..."

# 2) Data plane — Bearer JWT (KHÔNG gửi secret)
TOKEN="<access_token>"
curl -sS "https://thientinh.io.vn/v1/api/get" \\
  -H "Authorization: Bearer $TOKEN"`}</pre>
              </div>
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                Tiền tố <span className="font-mono">avaso_pk_</span>/<span className="font-mono">avaso_sk_</span>{' '}
                là OAuth2 client_id/client_secret — không phải cặp khóa RSA. Secret mã hóa AES trong DB;
                data plane xác thực JWT HS256.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
              <h4 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <Code className="w-5 h-5 text-sky-400" />
                Benchmark (wrk)
              </h4>
              <div className="bg-[#050810] rounded-lg p-4 font-mono-tech text-xs overflow-x-auto border border-border/80 shadow-inner">
                <pre className="text-slate-300">{`source ./scripts/ensure-bench-credentials.sh
export BENCH_URL="http://127.0.0.1:3000/health"   # baseline
./scripts/benchmark-gateway.sh

export BENCH_URL="http://127.0.0.1:3000/v1/api/get"  # JWT + routing
./scripts/benchmark-gateway.sh`}</pre>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
              <h4 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                Admin login
              </h4>
              <div className="bg-[#050810] rounded-lg p-4 font-mono-tech text-xs overflow-x-auto border border-border/80 shadow-inner">
                <pre className="text-slate-300">{`curl -X POST https://thientinh.io.vn/api/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"***"}' \\
  -c cookies.txt

# Response: {"status":"ok","access_token":"eyJ...","token_type":"Bearer",...}`}</pre>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
              <h4 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                List routes (session)
              </h4>
              <div className="bg-[#050810] rounded-lg p-4 font-mono-tech text-xs overflow-x-auto border border-border/80 shadow-inner">
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
