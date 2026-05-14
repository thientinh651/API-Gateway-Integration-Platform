import { useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { RefreshCw, Download, Filter, Search } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

interface LogEntry {
  id: string;
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  clientIp: string;
  apiKeyMasked: string;
}

export function Logs() {
  const [logs] = useState<LogEntry[]>([
    {
      id: '1',
      timestamp: '2026-05-14 10:30:45',
      requestId: 'req_abc123',
      method: 'GET',
      path: '/api/users',
      status: 200,
      duration: 45,
      clientIp: '192.168.1.100',
      apiKeyMasked: 'avaso_***abc',
    },
    {
      id: '2',
      timestamp: '2026-05-14 10:30:46',
      requestId: 'req_def456',
      method: 'POST',
      path: '/api/orders',
      status: 201,
      duration: 120,
      clientIp: '192.168.1.101',
      apiKeyMasked: 'avaso_***def',
    },
    {
      id: '3',
      timestamp: '2026-05-14 10:30:47',
      requestId: 'req_ghi789',
      method: 'GET',
      path: '/api/products',
      status: 200,
      duration: 38,
      clientIp: '192.168.1.102',
      apiKeyMasked: 'avaso_***ghi',
    },
    {
      id: '4',
      timestamp: '2026-05-14 10:30:48',
      requestId: 'req_jkl012',
      method: 'DELETE',
      path: '/api/users/123',
      status: 404,
      duration: 15,
      clientIp: '192.168.1.100',
      apiKeyMasked: 'avaso_***jkl',
    },
    {
      id: '5',
      timestamp: '2026-05-14 10:30:49',
      requestId: 'req_mno345',
      method: 'PUT',
      path: '/api/orders/456',
      status: 500,
      duration: 230,
      clientIp: '192.168.1.103',
      apiKeyMasked: 'avaso_***mno',
    },
    {
      id: '6',
      timestamp: '2026-05-14 10:30:50',
      requestId: 'req_pqr678',
      method: 'GET',
      path: '/api/users',
      status: 429,
      duration: 2,
      clientIp: '192.168.1.104',
      apiKeyMasked: 'avaso_***pqr',
    },
  ]);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');

  const getStatusBadgeClass = (status: number) => {
    if (status >= 200 && status < 300)
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (status >= 400 && status < 500)
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    if (status >= 500) return 'bg-red-500/10 text-red-400 border-red-500/20';
    return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  };

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      POST: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      PUT: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      DELETE: 'bg-red-500/10 text-red-400 border-red-500/20',
      PATCH: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    };
    return colors[method] || 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.requestId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.clientIp.includes(searchTerm);

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === '2xx' && log.status >= 200 && log.status < 300) ||
      (statusFilter === '4xx' && log.status >= 400 && log.status < 500) ||
      (statusFilter === '5xx' && log.status >= 500);

    const matchesMethod = methodFilter === 'all' || log.method === methodFilter;

    return matchesSearch && matchesStatus && matchesMethod;
  });

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Transaction Logs</h1>
        <p className="text-muted-foreground">Xem và phân tích logs giao dịch từ gateway</p>
      </div>

      <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6 mb-6">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Tìm kiếm theo path, request ID, IP..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-input border-border text-foreground"
              />
            </div>
          </div>
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="w-[150px] bg-input border-border text-foreground">
              <SelectValue placeholder="Method" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">All Methods</SelectItem>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px] bg-input border-border text-foreground">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="2xx">2xx Success</SelectItem>
              <SelectItem value="4xx">4xx Client Error</SelectItem>
              <SelectItem value="5xx">5xx Server Error</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="border-border">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" className="border-border">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </Card>

      <Card className="rounded-2xl overflow-hidden bg-card/80 backdrop-blur-sm border-border">
        <div className="p-6 border-b border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider">
            Logs ({filteredLogs.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Request ID</th>
                <th className="px-6 py-4">Method</th>
                <th className="px-6 py-4">Path</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Duration</th>
                <th className="px-6 py-4">Client IP</th>
                <th className="px-6 py-4">API Key</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="border-b border-border/50 hover:bg-primary/5">
                  <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                    {log.timestamp}
                  </td>
                  <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                    {log.requestId}
                  </td>
                  <td className="px-6 py-4">
                    <Badge className={`${getMethodColor(log.method)} border font-mono text-xs`}>
                      {log.method}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-slate-300 font-mono text-xs">{log.path}</td>
                  <td className="px-6 py-4">
                    <Badge className={`${getStatusBadgeClass(log.status)} border font-mono`}>
                      {log.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-slate-400">{log.duration}ms</td>
                  <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                    {log.clientIp}
                  </td>
                  <td className="px-6 py-4 text-slate-500 font-mono text-xs">
                    {log.apiKeyMasked}
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">
                    Không tìm thấy logs phù hợp với bộ lọc
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
