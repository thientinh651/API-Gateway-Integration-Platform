import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Card } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { Code } from 'lucide-react';
import { cn } from '../components/ui/utils';
import { TechPageHeader } from '../components/tech/TechPageHeader';
import { ApiEndpointCard } from '../components/tech/ApiEndpointCard';
import { MiddlewarePipelineBanner } from '../components/auth/MiddlewarePipelineBanner';
import { GuideTabContent } from './docs/DocsSections';
import {
  GUIDE_TABS,
  REFERENCE_TABS,
  TAB_CONFIG,
  isApiDocTab,
  type ApiDocTab,
} from './docs/docsNav';

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
            <Badge variant="outline" className="font-semibold text-white border-border/80 font-mono-tech">
              {meta.label}
            </Badge>
            <p className="text-sm text-slate-300 mt-1.5 leading-relaxed">{meta.description}</p>
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

const GUIDE_TRACK =
  'w-full h-auto flex flex-wrap gap-1 p-1.5 rounded-xl bg-slate-900/95 border border-slate-700/90';
const REF_TRACK =
  'w-full h-auto grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1.5 rounded-xl bg-slate-900/95 border border-slate-700/90';
const TAB_PILL_IDLE = 'bg-transparent text-slate-400 hover:text-slate-200 border-0 shadow-none';
const TAB_PILL_ACTIVE =
  'bg-slate-600 text-white shadow-[0_2px_10px_rgba(0,0,0,0.45)] border border-slate-500/80';

function TierLabel({ tier, title }: { tier: string; title: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-0.5 mb-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{tier}</span>
      <span className="text-xs font-semibold text-slate-200">{title}</span>
    </div>
  );
}

function TabPill({
  tabKey,
  selected,
  className,
}: {
  tabKey: ApiDocTab;
  selected: boolean;
  className?: string;
}) {
  const m = TAB_CONFIG[tabKey];
  return (
    <TabsTrigger
      value={tabKey}
      className={cn(
        'min-h-[42px] px-2.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-200',
        'data-[state=active]:bg-transparent data-[state=active]:text-inherit data-[state=active]:shadow-none',
        'dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-inherit',
        selected ? TAB_PILL_ACTIVE : TAB_PILL_IDLE,
        className
      )}
    >
      <span className="sm:hidden">{m.short}</span>
      <span className="hidden sm:inline text-center leading-snug">{m.label}</span>
    </TabsTrigger>
  );
}

function readInitialTab(): ApiDocTab {
  if (typeof window === 'undefined') return 'overview';
  const hash = window.location.hash.replace(/^#/, '');
  if (isApiDocTab(hash)) return hash;
  return 'overview';
}

export function ApiDocs() {
  const [activeTab, setActiveTab] = useState<ApiDocTab>(readInitialTab);

  const selectTab = useCallback((tab: ApiDocTab) => {
    setActiveTab(tab);
    window.history.replaceState(null, '', `#${tab}`);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (isApiDocTab(hash)) setActiveTab(hash);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const dataPlaneEndpoints = [
    {
      method: 'POST',
      path: '/oauth/token',
      description:
        'Identity — phát access_token (password | client_credentials | authorization_code). Rate limit: 20/phút/client_id, 50/phút/IP',
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
      path: '/{configured_route}/*',
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
    { method: 'PUT', path: '/api/oauth/apps/{id}', description: 'Sửa tên + redirect URI, optional rotate secret', auth: 'Admin', body: '{"name":"...","redirect_uris":["https://..."],"rotate_secret":false}' },
    { method: 'DELETE', path: '/api/oauth/apps/{id}', description: 'Xóa app OAuth bên thứ 3', auth: 'Admin', body: null },
    { method: 'GET', path: '/oauth/authorize', description: 'Consent + authorization code (PKCE S256 required)', auth: 'Session dashboard', body: '?client_id&redirect_uri&response_type=code&code_challenge&code_challenge_method=S256&state' },
    { method: 'POST', path: '/api/client-keys/encrypted', description: 'Đăng ký qua RSA envelope', auth: 'Operator+', body: 'CryptoEnvelope JSON' },
    { method: 'DELETE', path: '/api/client-keys/{id}', description: 'Xóa client khỏi registry', auth: 'Operator+', body: null },
    { method: 'GET', path: '/api/users', description: 'Danh sách admin users', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/users', description: 'Tạo user', auth: 'Admin', body: '{"username":"...","password":"***","role":"operator"}' },
    { method: 'PUT', path: '/api/users/{id}', description: 'Cập nhật user (tự đổi password cần current_password)', auth: 'Admin', body: '{"username":"...","role":"...","is_active":true,"password":"?","current_password":"?"}' },
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
    { method: 'GET', path: '/api/integrations/salesforce/connect', description: 'Bắt đầu OAuth SF', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/salesforce/sync', description: 'Sync snapshot SF', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/zoho/connect', description: 'Bắt đầu OAuth Zoho', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/zoho/sync', description: 'Sync snapshot Zoho', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/sync-now', description: 'Pipeline SF→Zoho (pull + lọc + push + log)', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/sync-schedule', description: 'Lịch tự động đồng bộ pipeline', auth: 'Admin', body: null },
    { method: 'PUT', path: '/api/integrations/sync-schedule', description: 'Đặt lịch auto sync (off | mỗi N phút | mỗi ngày HH:MM UTC+7)', auth: 'Admin', body: '{"mode":"interval","interval_mins":20} | {"mode":"daily","daily_hour":7,"daily_minute":0}' },
    { method: 'GET', path: '/api/integrations/pipeline-status', description: 'Trạng thái 4 bước pipeline', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/entity-links', description: 'Mapping Opportunity↔Project', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/sync-logs', description: 'Sync log middleware', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/snapshots', description: 'Snapshot pull về DB', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/reset-sync', description: 'Xóa entity links cũ', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/reload-config', description: 'Reload routes từ DB', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/crypto/public-key', description: 'RSA public key của gateway (envelope đăng ký client — không phải client_id avaso_pk_)', auth: 'Không', body: null },
  ];

  const errorCodes = [
    { code: '401', description: 'Thiếu / sai / hết hạn JWT — chưa được xác thực data plane' },
    { code: '403', description: 'Có token nhưng bị cấm — client tắt, không có ACL, hoặc sai quyền admin' },
    { code: '404', description: 'Không tìm thấy route khớp path được gọi' },
    { code: '429', description: 'Gọi quá hạn mức (rate limit) — xem Retry-After' },
    { code: '502', description: 'Gateway đã chuyển tiếp nhưng upstream trả lỗi / không phản hồi đúng' },
    { code: '504', description: 'Upstream chậm quá thời gian chờ (timeout)' },
    { code: '500', description: 'Lỗi nội bộ gateway' },
  ];

  const middlewareErrorFields = [
    { field: 'missing_token', description: 'Thiếu header Authorization: Bearer …' },
    { field: 'invalid_token', description: 'JWT sai chữ ký, issuer hoặc format' },
    { field: 'token_expired', description: 'JWT đã hết hạn (claim exp)' },
    { field: 'client_key_disabled', description: 'Client trong Registry đang bị tắt' },
    { field: 'route_forbidden', description: 'Path này chưa được gán cho client của token' },
    { field: 'rate_limit_exceeded', description: 'Hết hạn mức gọi — xem Retry-After' },
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
        codeLine="// documentation + api reference"
        title="Tài liệu API"
      />

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          if (isApiDocTab(v)) selectTab(v);
        }}
        className="space-y-4"
      >
        <div className="space-y-3">
          <div>
            <TierLabel
              tier="01"
              title="Hướng dẫn"
            />
            <TabsList className={cn(GUIDE_TRACK, 'bg-muted/0')}>
              {GUIDE_TABS.map((key) => (
                <TabPill key={key} tabKey={key} selected={activeTab === key} />
              ))}
            </TabsList>
          </div>
          <div>
            <TierLabel
              tier="02"
              title="API Reference"
            />
            <TabsList className={cn(REF_TRACK, 'bg-muted/0')}>
              {REFERENCE_TABS.map((key) => (
                <TabPill key={key} tabKey={key} selected={activeTab === key} className="w-full justify-center" />
              ))}
            </TabsList>
          </div>
        </div>

        {GUIDE_TABS.map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-0 focus-visible:outline-none">
            <DocSectionFrame tab={tab} title={TAB_CONFIG[tab].label}>
              <GuideTabContent tab={tab} />
            </DocSectionFrame>
          </TabsContent>
        ))}

        <TabsContent value="data-plane" className="mt-0 focus-visible:outline-none space-y-4">
          <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">
            Đây là các đường dẫn <strong className="text-slate-200">ứng dụng </strong> gọi qua gateway.
          </p>
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

        <TabsContent value="admin-api" className="mt-0 focus-visible:outline-none space-y-4">
          <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">
            Endpoint dành cho <strong className="text-slate-200">dashboard</strong> (cookie session hoặc API
            key admin). Dùng để cấu hình hệ thống — không phải đường gọi dữ liệu của app end-user.
          </p>
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
          <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">
            Khi request thất bại, nhìn mã HTTP trước; với data plane còn có trường JSON{' '}
            <code className="font-mono-tech text-slate-300">error</code> chi tiết hơn.
          </p>
          <DocSectionFrame tab="errors" title="HTTP status">
            <div className="space-y-3">
              {errorCodes.map((error) => (
                <div
                  key={error.code}
                  className="flex items-start gap-4 p-3 rounded-lg bg-background/50 border border-border"
                >
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
                <div
                  key={row.field}
                  className="flex items-start gap-4 p-3 rounded-lg bg-background/50 border border-border"
                >
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] text-amber-400 border-amber-500/30 shrink-0"
                  >
                    {row.field}
                  </Badge>
                  <p className="text-sm text-slate-300">{row.description}</p>
                </div>
              ))}
            </div>
          </DocSectionFrame>
        </TabsContent>

        <TabsContent value="examples" className="mt-0 focus-visible:outline-none space-y-4">
          <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">
            Copy lệnh mẫu, thay Client ID / Secret / cookie . Luồng đầy đủ hơn nằm ở tầng 1 → Quick
            Start.
          </p>
          <DocSectionFrame tab="examples" title="Ví dụ curl">
            <div className="grid gap-6">
              <div className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
                <h4 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <Code className="w-5 h-5 text-sky-400" />
                  Tạo client và gán route
                </h4>
                <p className="text-xs text-muted-foreground mb-3">Cần đã đăng nhập dashboard (cookie).</p>
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
                <h4 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <Code className="w-5 h-5 text-emerald-400" />
                  Lấy JWT rồi gọi data plane
                </h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Secret chỉ dùng ở bước 1. Bước 2 chỉ gửi Bearer JWT.
                </p>
                <div className="bg-[#050810] rounded-lg p-4 font-mono-tech text-xs overflow-x-auto border border-border/80 shadow-inner">
                  <pre className="text-slate-300">{`# 1) Lấy JWT
curl -sS -X POST https://thientinh.io.vn/api/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials&client_id=avaso_pk_...&client_secret=avaso_sk_..."

# 2) Gọi API
TOKEN="<access_token>"
curl -sS "https://thientinh.io.vn/v1/api/get" \\
  -H "Authorization: Bearer $TOKEN"`}</pre>
                </div>
                <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                  <span className="font-mono">avaso_pk_</span> / <span className="font-mono">avaso_sk_</span> là
                  Client ID / Secret — không phải khóa RSA.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
                <h4 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <Code className="w-5 h-5 text-sky-400" />
                  Benchmark (wrk)
                </h4>
                <div className="bg-[#050810] rounded-lg p-4 font-mono-tech text-xs overflow-x-auto border border-border/80 shadow-inner">
                  <pre className="text-slate-300">{`source ./scripts/ensure-bench-credentials.sh
export BENCH_URL="http://127.0.0.1:3000/health"
./scripts/benchmark-gateway.sh

export BENCH_URL="http://127.0.0.1:3000/v1/api/get"
./scripts/benchmark-gateway.sh`}</pre>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
                <h4 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <Code className="w-5 h-5 text-primary" />
                  Đăng nhập admin
                </h4>
                <div className="bg-[#050810] rounded-lg p-4 font-mono-tech text-xs overflow-x-auto border border-border/80 shadow-inner">
                  <pre className="text-slate-300">{`curl -X POST https://thientinh.io.vn/api/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"***"}' \\
  -c cookies.txt`}</pre>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
                <h4 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <Code className="w-5 h-5 text-primary" />
                  Liệt kê routes
                </h4>
                <div className="bg-[#050810] rounded-lg p-4 font-mono-tech text-xs overflow-x-auto border border-border/80 shadow-inner">
                  <pre className="text-slate-300">{`curl https://thientinh.io.vn/api/routes -b cookies.txt

# Hoặc:
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
