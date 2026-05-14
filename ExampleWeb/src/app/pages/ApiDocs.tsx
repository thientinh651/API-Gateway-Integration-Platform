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
      auth: 'None',
      response: '200 OK - {"status":"ok"}',
    },
    {
      method: 'GET',
      path: '/metrics',
      description: 'Prometheus metrics endpoint',
      auth: 'None (hoặc internal only)',
      response: 'text/plain - Prometheus format',
    },
    {
      method: '*',
      path: '/{configured_routes}',
      description: 'Proxy đến upstream theo cấu hình',
      auth: 'X-API-Key header',
      response: 'Response từ upstream',
    },
  ];

  const adminEndpoints = [
    {
      method: 'POST',
      path: '/admin/login',
      description: 'Đăng nhập admin',
      auth: 'None',
      body: '{"username": "admin", "password": "***"}',
    },
    {
      method: 'POST',
      path: '/admin/logout',
      description: 'Đăng xuất',
      auth: 'Session cookie',
      body: null,
    },
    {
      method: 'GET',
      path: '/admin/routes',
      description: 'Lấy danh sách routes',
      auth: 'Viewer/Operator/Admin',
      body: null,
    },
    {
      method: 'POST',
      path: '/admin/routes',
      description: 'Tạo route mới',
      auth: 'Operator/Admin',
      body: '{"method": "GET", "path": "/api/test", "upstream": "http://..."}',
    },
    {
      method: 'PUT',
      path: '/admin/routes/{id}',
      description: 'Cập nhật route',
      auth: 'Operator/Admin',
      body: '{"method": "POST", "path": "/api/test", ...}',
    },
    {
      method: 'DELETE',
      path: '/admin/routes/{id}',
      description: 'Xóa route',
      auth: 'Operator/Admin',
      body: null,
    },
    {
      method: 'GET',
      path: '/admin/keys',
      description: 'Lấy danh sách API keys',
      auth: 'Viewer/Operator/Admin',
      body: null,
    },
    {
      method: 'POST',
      path: '/admin/keys',
      description: 'Tạo API key mới',
      auth: 'Operator/Admin',
      body: '{"name": "App Name", "rate_limit": 100}',
    },
    {
      method: 'DELETE',
      path: '/admin/keys/{id}',
      description: 'Revoke API key',
      auth: 'Operator/Admin',
      body: null,
    },
    {
      method: 'GET',
      path: '/admin/users',
      description: 'Lấy danh sách users',
      auth: 'Admin only',
      body: null,
    },
    {
      method: 'POST',
      path: '/admin/users',
      description: 'Tạo user mới',
      auth: 'Admin only',
      body: '{"username": "user1", "password": "***", "role": "Operator"}',
    },
    {
      method: 'GET',
      path: '/admin/logs',
      description: 'Xem transaction logs',
      auth: 'Viewer/Operator/Admin',
      body: null,
    },
    {
      method: 'GET',
      path: '/admin/audit',
      description: 'Xem audit logs',
      auth: 'Admin/Operator',
      body: null,
    },
  ];

  const errorCodes = [
    { code: '401', description: 'Unauthorized - Thiếu/sai API key hoặc session' },
    { code: '403', description: 'Forbidden - Không đủ quyền (RBAC)' },
    { code: '404', description: 'Not Found - Route không tồn tại' },
    { code: '405', description: 'Method Not Allowed - Method không được hỗ trợ' },
    { code: '429', description: 'Too Many Requests - Vượt rate limit' },
    { code: '502', description: 'Bad Gateway - Upstream connection failed' },
    { code: '504', description: 'Gateway Timeout - Upstream timeout' },
    { code: '500', description: 'Internal Server Error - Lỗi hệ thống' },
  ];

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      POST: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      PUT: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      DELETE: 'bg-red-500/10 text-red-400 border-red-500/20',
      PATCH: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      '*': 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    };
    return colors[method] || colors['*'];
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Tài liệu API</h1>
        <p className="text-muted-foreground">
          Hướng dẫn sử dụng Data Plane và Admin API
        </p>
      </div>

      <Tabs defaultValue="data-plane" className="space-y-6">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="data-plane">Data Plane API</TabsTrigger>
          <TabsTrigger value="admin-api">Admin API</TabsTrigger>
          <TabsTrigger value="errors">Error Codes</TabsTrigger>
          <TabsTrigger value="examples">Examples</TabsTrigger>
        </TabsList>

        <TabsContent value="data-plane">
          <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
            <h3 className="text-lg font-bold text-white mb-4">Data Plane Endpoints</h3>
            <div className="space-y-4">
              {dataPlaneEndpoints.map((endpoint, index) => (
                <div
                  key={index}
                  className="p-4 rounded-lg bg-background/50 border border-border"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className={`${getMethodColor(endpoint.method)} border font-mono`}>
                      {endpoint.method}
                    </Badge>
                    <code className="text-sm text-slate-300 font-mono">{endpoint.path}</code>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{endpoint.description}</p>
                  <div className="grid grid-cols-2 gap-4 text-xs">
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
            <h3 className="text-lg font-bold text-white mb-4">Admin API Endpoints</h3>
            <div className="space-y-4">
              {adminEndpoints.map((endpoint, index) => (
                <div
                  key={index}
                  className="p-4 rounded-lg bg-background/50 border border-border"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className={`${getMethodColor(endpoint.method)} border font-mono`}>
                      {endpoint.method}
                    </Badge>
                    <code className="text-sm text-slate-300 font-mono">{endpoint.path}</code>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{endpoint.description}</p>
                  <div className="text-xs space-y-1">
                    <div>
                      <span className="text-muted-foreground">Auth: </span>
                      <span className="text-amber-400">{endpoint.auth}</span>
                    </div>
                    {endpoint.body && (
                      <div>
                        <span className="text-muted-foreground">Body: </span>
                        <code className="text-slate-300 text-xs bg-background/80 px-2 py-1 rounded">
                          {endpoint.body}
                        </code>
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
          </Card>
        </TabsContent>

        <TabsContent value="examples">
          <div className="grid gap-6">
            <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                Example: Client Request
              </h3>
              <div className="bg-background/80 rounded-lg p-4 font-mono text-xs">
                <pre className="text-slate-300">
{`curl -X GET https://thientinh.io.vn/api/users \\
  -H "X-API-Key: avaso_your_api_key_here"

Response:
{
  "users": [...],
  "total": 100
}`}
                </pre>
              </div>
            </Card>

            <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                Example: Admin Login
              </h3>
              <div className="bg-background/80 rounded-lg p-4 font-mono text-xs">
                <pre className="text-slate-300">
{`curl -X POST https://thientinh.io.vn/admin/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"your_password"}' \\
  -c cookies.txt

Response:
{
  "status": "ok",
  "role": "Admin"
}`}
                </pre>
              </div>
            </Card>

            <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                Example: Create Route
              </h3>
              <div className="bg-background/80 rounded-lg p-4 font-mono text-xs">
                <pre className="text-slate-300">
{`curl -X POST https://thientinh.io.vn/admin/routes \\
  -H "Content-Type: application/json" \\
  -b cookies.txt \\
  -d '{
    "method": "GET",
    "path": "/api/products",
    "upstream": "http://localhost:3000/products",
    "timeout": 30,
    "rate_limit": 100
  }'

Response:
{
  "id": "route_123",
  "status": "created"
}`}
                </pre>
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
