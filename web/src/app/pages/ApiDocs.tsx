import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '../components/ui/badge';
import { Code, Rocket } from 'lucide-react';
import { cn } from '../components/ui/utils';
import { TechPageHeader } from '../components/tech/TechPageHeader';
import { ApiEndpointCard } from '../components/tech/ApiEndpointCard';
import { MiddlewarePipelineBanner } from '../components/auth/MiddlewarePipelineBanner';
import { GuideTabContent } from './docs/DocsSections';
import { CodeBlock, DEMO_HOST } from './docs/DocPrimitives';
import {
  GUIDE_TABS,
  NAV_SECTIONS,
  TAB_CONFIG,
  TAB_ORDER,
  isApiDocTab,
  resolveDocHash,
  type ApiDocTab,
} from './docs/docsNav';

function DocArticle({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <article className="min-w-0 space-y-5">
      <header className="space-y-2 border-b border-border/60 pb-4">
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{title}</h2>
        <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">{description}</p>
      </header>
      {children}
    </article>
  );
}

function readInitialTab(): ApiDocTab {
  if (typeof window === 'undefined') return 'start-here';
  return resolveDocHash(window.location.hash);
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
      const next = resolveDocHash(window.location.hash);
      setActiveTab(next);
      if (!isApiDocTab(window.location.hash.replace(/^#/, ''))) {
        window.history.replaceState(null, '', `#${next}`);
      }
    };
    window.addEventListener('hashchange', onHash);
    // Chuẩn hóa hash cũ ngay lần mount
    const resolved = resolveDocHash(window.location.hash);
    if (window.location.hash.replace(/^#/, '') !== resolved) {
      window.history.replaceState(null, '', `#${resolved}`);
    }
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const dataPlaneEndpoints = [
    {
      method: 'POST',
      path: '/oauth/token',
      description:
        'Phát access_token (password | client_credentials | authorization_code). Rate limit token endpoint.',
      auth: 'Không (public)',
      response: '{"access_token":"eyJ...","token_type":"Bearer","expires_in":3600}',
    },
    {
      method: 'GET',
      path: '/health',
      description: 'Healthcheck gateway',
      auth: 'Không',
      response: '200 — {"status":"ok",...}',
    },
    {
      method: 'GET',
      path: '/metrics',
      description: 'Metrics (stub JSON; có thể tắt trong Settings)',
      auth: 'Không',
      response: '200 JSON hoặc 404 nếu disabled',
    },
    {
      method: 'GET',
      path: '/v1/api/canonical/contacts',
      description: 'Danh sách contact canonical (?target=sf|zoho)',
      auth: 'Bearer JWT',
      response: '{"entity":"contact","format":"canonical","data":[...]}',
    },
    {
      method: 'POST',
      path: '/v1/api/canonical/contacts',
      description: 'Tạo contact canonical, target=sf|zoho',
      auth: 'Bearer JWT',
      response: 'Canonical record sau transform',
    },
    {
      method: '*',
      path: '/v1/api/*',
      description: 'Longest-prefix match → proxy upstream',
      auth: 'Authorization: Bearer <JWT>',
      response: 'Response upstream',
    },
    {
      method: '*',
      path: '/{configured_route}/*',
      description: 'Mọi path đã tạo trên Dashboard Routes',
      auth: 'Bearer JWT',
      response: 'Response upstream',
    },
  ];

  const adminEndpoints = [
    { method: 'POST', path: '/api/login', description: 'Đăng nhập admin', auth: 'Không', body: '{"username":"admin","password":"***"}' },
    { method: 'POST', path: '/api/register', description: 'Đăng ký Viewer (ALLOW_VIEWER_REGISTRATION=1)', auth: 'Không', body: '{"username":"...","email":"...","password":"***"}' },
    { method: 'POST', path: '/api/logout', description: 'Đăng xuất', auth: 'Session cookie', body: null },
    { method: 'GET', path: '/api/me', description: 'User hiện tại', auth: 'Session', body: null },
    { method: 'PUT', path: '/api/me', description: 'Cập nhật hồ sơ', auth: 'Session', body: '{"username":"?","email":"?","password":"?","current_password":"*"}' },
    { method: 'POST', path: '/api/forgot-password', description: 'Gửi OTP quên mật khẩu', auth: 'Không', body: '{"username":"...","email":"..."}' },
    { method: 'POST', path: '/api/verify-reset-otp', description: 'Xác minh OTP', auth: 'Không', body: '{"username":"...","otp":"123456"}' },
    { method: 'POST', path: '/api/reset-password', description: 'Đặt mật khẩu mới', auth: 'Không', body: '{"reset_token":"...","password":"***"}' },
    { method: 'GET', path: '/api/routes', description: 'Danh sách routes', auth: 'Viewer+', body: null },
    { method: 'POST', path: '/api/routes', description: 'Tạo route', auth: 'Admin', body: '{"path":"/v1/api/foo","target":"https://...","timeout_secs":30}' },
    { method: 'PUT', path: '/api/routes/{id}', description: 'Cập nhật route', auth: 'Operator+', body: 'RouteWriteBody' },
    { method: 'DELETE', path: '/api/routes/{id}', description: 'Xóa route', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/client-keys', description: 'Danh sách client', auth: 'Operator+', body: null },
    { method: 'POST', path: '/api/client-keys', description: 'Tạo OAuth2 client', auth: 'Operator+', body: '{"name":"web-shop","integration_type":"app","rate_limit_per_min":100}' },
    { method: 'PATCH', path: '/api/client-keys/{id}', description: 'Sửa status / rate limit', auth: 'Operator+', body: '{"status":"disabled","rate_limit_per_min":200}' },
    { method: 'POST', path: '/api/client-keys/bulk-status', description: 'Bật/tắt nhiều client', auth: 'Operator+', body: '{"ids":[1,2],"status":"disabled"}' },
    { method: 'PUT', path: '/api/client-keys/{id}/routes', description: 'Gán ACL routes', auth: 'Operator+', body: '{"route_ids":[1,2]}' },
    { method: 'GET', path: '/api/client-keys/traffic-summary', description: 'Traffic 24h theo client', auth: 'Operator+', body: null },
    { method: 'GET', path: '/api/client-keys/{id}/traffic', description: 'Traffic 1 client', auth: 'Operator+', body: '?hours=24' },
    { method: 'POST', path: '/api/client-keys/{id}/rotate', description: 'Rotate client_secret', auth: 'Operator+', body: null },
    { method: 'POST', path: '/api/client-keys/{id}/revoke-tokens', description: 'Thu hồi mọi JWT client', auth: 'Operator+', body: null },
    { method: 'GET', path: '/api/oauth/tokens', description: 'Audit JWT', auth: 'Operator+', body: '?active_only=true&limit=100' },
    { method: 'POST', path: '/api/oauth/tokens/revoke', description: 'Thu hồi theo jti', auth: 'Operator+', body: '{"jti":"uuid"}' },
    { method: 'POST', path: '/api/oauth/revoke', description: 'RFC 7009 revoke raw token', auth: 'Không', body: 'token=eyJ...' },
    { method: 'POST', path: '/api/oauth/logout', description: 'Thu hồi Bearer đang gửi', auth: 'Bearer JWT', body: null },
    { method: 'GET', path: '/api/oauth/apps', description: 'App OAuth bên thứ 3', auth: 'Operator+', body: null },
    { method: 'POST', path: '/api/oauth/apps', description: 'Đăng ký app + redirect_uris', auth: 'Admin', body: '{"name":"Partner","redirect_uris":["https://..."],"with_secret":true}' },
    { method: 'PUT', path: '/api/oauth/apps/{id}', description: 'Sửa app OAuth', auth: 'Admin', body: '{"name":"...","redirect_uris":["https://..."],"rotate_secret":false}' },
    { method: 'DELETE', path: '/api/oauth/apps/{id}', description: 'Xóa app OAuth', auth: 'Admin', body: null },
    { method: 'GET', path: '/oauth/authorize', description: 'Authorization Code + PKCE S256', auth: 'Session dashboard', body: '?client_id&redirect_uri&response_type=code&code_challenge&...' },
    { method: 'POST', path: '/api/client-keys/encrypted', description: 'Đăng ký qua RSA envelope', auth: 'Operator+', body: 'CryptoEnvelope JSON' },
    { method: 'DELETE', path: '/api/client-keys/{id}', description: 'Xóa client', auth: 'Operator+', body: null },
    { method: 'GET', path: '/api/users', description: 'Danh sách users', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/users', description: 'Tạo user', auth: 'Admin', body: '{"username":"...","password":"***","role":"operator"}' },
    { method: 'PUT', path: '/api/users/{id}', description: 'Cập nhật user', auth: 'Admin', body: '{"username":"...","role":"...","is_active":true}' },
    { method: 'DELETE', path: '/api/users/{id}', description: 'Xóa user', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/audit-logs', description: 'Audit log', auth: 'Viewer+', body: '?limit=&result=&search=' },
    { method: 'GET', path: '/api/transaction-logs', description: 'Transaction log', auth: 'Viewer+', body: '?limit=&method=&status=&...' },
    { method: 'GET', path: '/api/proxy-queue', description: 'DLQ', auth: 'Viewer+', body: null },
    { method: 'POST', path: '/api/proxy-queue/{id}/retry', description: 'Replay DLQ', auth: 'Operator+', body: null },
    { method: 'GET', path: '/api/integrations', description: 'Trạng thái SF/Zoho', auth: 'Admin', body: null },
    { method: 'PUT', path: '/api/settings', description: 'Settings', auth: 'Admin', body: 'GatewaySettingsWriteBody' },
    { method: 'GET', path: '/api/middleware/status', description: 'Runtime middleware', auth: 'Viewer+', body: null },
    { method: 'GET', path: '/api/dashboard/stats', description: 'Overview stats', auth: 'Viewer+', body: null },
    { method: 'GET', path: '/api/integrations/salesforce/connect', description: 'OAuth SF', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/salesforce/sync', description: 'Sync snapshot SF', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/zoho/connect', description: 'OAuth Zoho', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/zoho/sync', description: 'Sync snapshot Zoho', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/sync-now', description: 'Pipeline SF→Zoho', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/sync-schedule', description: 'Đọc lịch sync', auth: 'Admin', body: null },
    { method: 'PUT', path: '/api/integrations/sync-schedule', description: 'Đặt lịch sync', auth: 'Admin', body: '{"mode":"interval","interval_mins":20}' },
    { method: 'GET', path: '/api/integrations/pipeline-status', description: 'Trạng thái pipeline', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/entity-links', description: 'Mapping Opportunity↔Project', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/sync-logs', description: 'Sync logs', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/integrations/snapshots', description: 'Snapshots', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/integrations/reset-sync', description: 'Xóa entity links cũ', auth: 'Admin', body: null },
    { method: 'POST', path: '/api/reload-config', description: 'Reload routes từ DB', auth: 'Admin', body: null },
    { method: 'GET', path: '/api/crypto/public-key', description: 'RSA public key (envelope)', auth: 'Không', body: null },
  ];

  const errorCodes = [
    { code: '401', description: 'Thiếu / sai / hết hạn JWT' },
    { code: '403', description: 'Token OK nhưng bị cấm (ACL, client tắt, sai role)' },
    { code: '404', description: 'Không có route khớp path' },
    { code: '429', description: 'Rate limit — xem Retry-After' },
    { code: '502', description: 'Upstream lỗi / không phản hồi đúng' },
    { code: '504', description: 'Upstream timeout' },
    { code: '500', description: 'Lỗi nội bộ gateway' },
  ];

  const middlewareErrorFields = [
    { field: 'missing_token', description: 'Thiếu Authorization: Bearer …' },
    { field: 'invalid_token', description: 'JWT sai chữ ký / issuer / format' },
    { field: 'token_expired', description: 'JWT hết hạn (exp)' },
    { field: 'client_key_disabled', description: 'Client đang tắt' },
    { field: 'route_forbidden', description: 'Path chưa gán ACL cho client' },
    { field: 'rate_limit_exceeded', description: 'Hết hạn mức — xem Retry-After' },
  ];

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      POST: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      PUT: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      PATCH: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
      DELETE: 'bg-red-500/10 text-red-400 border-red-500/20',
      '*': 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    };
    return colors[method] || colors['*'];
  };

  const meta = TAB_CONFIG[activeTab];
  const isGuide = GUIDE_TABS.includes(activeTab);

  return (
    <>
      <TechPageHeader
        codeLine="// hướng dẫn sử dụng"
        title="Hướng dẫn sử dụng"
      />

      <div className="mb-6 rounded-xl border border-border/70 bg-card/40 px-4 py-4 sm:px-5 sm:py-5 max-w-5xl">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div className="space-y-1 min-w-0">
            <p className="text-base font-semibold text-white">AVASO Gateway</p>
            <p className="text-sm text-slate-400 leading-relaxed">
              Hướng dẫn cấu hình Route và Client trên dashboard, lấy JWT, rồi gọi API qua{' '}
              <code className="font-mono-tech text-slate-300">/v1/api/…</code>. Làm theo thứ tự bên
              trái.
            </p>
          </div>
          <button
            type="button"
            onClick={() => selectTab('first-call')}
            className="inline-flex items-center justify-center gap-2 shrink-0 rounded-lg bg-primary/90 hover:bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            <Rocket className="w-4 h-4" />
            Gọi API
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">
        {/* Sidebar nav */}
        <nav
          aria-label="Mục lục tài liệu"
          className="w-full lg:w-56 shrink-0 lg:sticky lg:top-4 space-y-4 rounded-xl border border-border/60 bg-background/40 p-3"
        >
          {NAV_SECTIONS.map((section) => (
            <div key={section.id} className="space-y-1">
              <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.tabs.map((tabKey) => {
                  const t = TAB_CONFIG[tabKey];
                  const selected = activeTab === tabKey;
                  return (
                    <li key={tabKey}>
                      <button
                        type="button"
                        onClick={() => selectTab(tabKey)}
                        className={cn(
                          'w-full text-left rounded-md px-2.5 py-1.5 text-sm transition-colors',
                          selected
                            ? 'bg-slate-700/80 text-white font-medium'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50',
                        )}
                      >
                        {t.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Content */}
        <div className="min-w-0 flex-1 w-full max-w-3xl">
          {isGuide ? (
            <DocArticle title={meta.label} description={meta.description}>
              <GuideTabContent tab={activeTab} onSelectTab={selectTab} />
            </DocArticle>
          ) : null}

          {activeTab === 'data-plane' ? (
            <DocArticle title={meta.label} description={meta.description}>
              <p className="text-sm text-slate-400 leading-relaxed">
                Các endpoint mà <strong className="text-slate-200">ứng dụng</strong> gọi qua gateway. Hầu
                hết yêu cầu header Bearer JWT; chỉ health và token endpoint là public.
              </p>
              <MiddlewarePipelineBanner compact />
              <div className="space-y-3 pt-2">
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
            </DocArticle>
          ) : null}

          {activeTab === 'admin-api' ? (
            <DocArticle title={meta.label} description={meta.description}>
              <p className="text-sm text-slate-400 leading-relaxed">
                Các endpoint dùng cho <strong className="text-slate-200">dashboard</strong> (xác thực bằng
                session cookie). Dùng để cấu hình hệ thống — không phải đường gọi dữ liệu của ứng dụng
                end-user.
              </p>
              <div className="space-y-3 pt-2">
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
                      {endpoint.body ? (
                        <div>
                          <span className="text-muted-foreground">body → </span>
                          <code className="text-slate-300 text-xs">{endpoint.body}</code>
                        </div>
                      ) : null}
                    </div>
                  </ApiEndpointCard>
                ))}
              </div>
            </DocArticle>
          ) : null}

          {activeTab === 'errors' ? (
            <DocArticle title={meta.label} description={meta.description}>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">HTTP status</h3>
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
              <div className="space-y-3 pt-4">
                <h3 className="text-sm font-semibold text-white">JSON error (data plane)</h3>
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
              <p className="text-sm text-slate-400 pt-2">
                Cách xử lý từng mã:{' '}
                <button
                  type="button"
                  onClick={() => selectTab('troubleshoot')}
                  className="text-primary hover:underline font-medium"
                >
                  Xử lý sự cố
                </button>
                .
              </p>
            </DocArticle>
          ) : null}

          {activeTab === 'examples' ? (
            <DocArticle title={meta.label} description={meta.description}>
              <p className="text-sm text-slate-400 leading-relaxed">
                Bộ lệnh curl copy-paste cho luồng hoàn chỉnh. Thay Client ID, Secret và token bằng giá trị
                thực tế của bạn. Hướng dẫn từng bước trên giao diện:{' '}
                <button
                  type="button"
                  onClick={() => selectTab('first-call')}
                  className="text-primary hover:underline font-medium"
                >
                  Gọi API
                </button>
                .
              </p>

              <div className="space-y-6 pt-2">
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Code className="w-4 h-4 text-primary" />
                    1) Đăng nhập admin
                  </h4>
                  <CodeBlock>{`curl -X POST ${DEMO_HOST}/api/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"***"}' \\
  -c cookies.txt`}</CodeBlock>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Code className="w-4 h-4 text-sky-400" />
                    2) Tạo route
                  </h4>
                  <CodeBlock>{`curl -X POST ${DEMO_HOST}/api/routes \\
  -b cookies.txt -H "Content-Type: application/json" \\
  -d '{
    "path":"/v1/api/demo/get",
    "target":"https://httpbin.org/get",
    "timeout_secs":30,
    "rate_limit_per_min":100,
    "allowed_methods":"GET",
    "retry_max":0,
    "queue_on_failure":false
  }'`}</CodeBlock>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Code className="w-4 h-4 text-sky-400" />
                    3) Tạo client + gắn ACL
                  </h4>
                  <CodeBlock>{`curl -X POST ${DEMO_HOST}/api/client-keys \\
  -b cookies.txt -H "Content-Type: application/json" \\
  -d '{"name":"demo-app","integration_type":"app","rate_limit_per_min":100}'

# Gắn route_id vừa tạo (thay 1):
curl -X PUT ${DEMO_HOST}/api/client-keys/1/routes \\
  -b cookies.txt -H "Content-Type: application/json" \\
  -d '{"route_ids":[1]}'`}</CodeBlock>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Code className="w-4 h-4 text-emerald-400" />
                    4) Lấy JWT → gọi data plane
                  </h4>
                  <CodeBlock>{`curl -sS -X POST ${DEMO_HOST}/api/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials&client_id=avaso_cid_...&client_secret=avaso_csec_..."

TOKEN="<access_token>"
curl -sS -i "${DEMO_HOST}/v1/api/demo/get" \\
  -H "Authorization: Bearer $TOKEN"`}</CodeBlock>
                  <p className="text-xs text-muted-foreground">
                    Client Secret chỉ dùng khi lấy token. Khi gọi{' '}
                    <code className="font-mono-tech">/v1/api/*</code>, chỉ gửi Bearer JWT trong header
                    Authorization.
                  </p>
                </div>

                <p className="text-sm text-slate-400 pt-4">
                  Bạn cũng có thể cấu hình trên giao diện:{' '}
                  <Link to="/routes" className="text-primary hover:underline">
                    Routes
                  </Link>
                  {' · '}
                  <Link to="/auth" className="text-primary hover:underline">
                    Clients
                  </Link>
                  {' · '}
                  <Link to="/proxy-try" className="text-primary hover:underline">
                    Thử gọi proxy
                  </Link>
                  .
                </p>
              </div>
            </DocArticle>
          ) : null}

          {/* Mobile section jumper */}
          <div className="lg:hidden pt-8 border-t border-border/50 mt-8">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Chuyển mục
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TAB_ORDER.map((tabKey) => (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => selectTab(tabKey)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs border transition-colors',
                    activeTab === tabKey
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border/60 text-slate-400',
                  )}
                >
                  {TAB_CONFIG[tabKey].short}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
