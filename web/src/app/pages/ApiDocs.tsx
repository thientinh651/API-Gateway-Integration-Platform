import { Card } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { Code } from 'lucide-react';

export function ApiDocs() {
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
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Tài liệu API</h1>
        <p className="text-muted-foreground">
          Admin API mount tại <code className="text-primary">/api/*</code> — session cookie hoặc header{' '}
          <code className="text-primary">X-API-Key</code> (admin).
        </p>
      </div>

      <Tabs defaultValue="data-plane" className="space-y-6">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="data-plane">Data Plane</TabsTrigger>
          <TabsTrigger value="admin-api">Admin API</TabsTrigger>
          <TabsTrigger value="errors">Error Codes</TabsTrigger>
          <TabsTrigger value="examples">Examples</TabsTrigger>
        </TabsList>

        <TabsContent value="data-plane">
          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
            <h3 className="text-lg font-bold text-white mb-4">Data Plane</h3>
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
          </Card>
        </TabsContent>

        <TabsContent value="admin-api">
          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
            <h3 className="text-lg font-bold text-white mb-4">Admin API</h3>
            <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
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
          </Card>
        </TabsContent>

        <TabsContent value="errors">
          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
            <h3 className="text-lg font-bold text-white mb-4">HTTP Error Codes</h3>
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
          </Card>
        </TabsContent>

        <TabsContent value="examples">
          <div className="grid gap-6">
            <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                HMAC data-plane request
              </h3>
              <div className="bg-background/80 rounded-lg p-4 font-mono text-xs overflow-x-auto">
                <pre className="text-slate-300">{`# Ký payload: api_key\\ntimestamp\\nMETHOD\\npath?query\\nbody
curl -X GET "https://thientinh.io.vn/v1/api/get" \\
  -H "X-API-Key: avaso_pk_..." \\
  -H "X-Timestamp: $(date +%s)" \\
  -H "X-Signature: <hmac_sha256_hex>"`}</pre>
              </div>
            </Card>

            <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                Admin login
              </h3>
              <div className="bg-background/80 rounded-lg p-4 font-mono text-xs overflow-x-auto">
                <pre className="text-slate-300">{`curl -X POST https://thientinh.io.vn/api/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"***"}' \\
  -c cookies.txt

# Response: {"status":"ok","username":"admin","role":"admin",...}`}</pre>
              </div>
            </Card>

            <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                List routes (session)
              </h3>
              <div className="bg-background/80 rounded-lg p-4 font-mono text-xs overflow-x-auto">
                <pre className="text-slate-300">{`curl https://thientinh.io.vn/api/routes -b cookies.txt

# Hoặc admin key:
curl https://thientinh.io.vn/api/routes -H "X-API-Key: <admin_key>"`}</pre>
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
