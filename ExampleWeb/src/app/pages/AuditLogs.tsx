import { useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { RefreshCw, Download, Search, Shield, CheckCircle2, XCircle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  role: string;
  action: string;
  resource: string;
  result: 'success' | 'failure';
  sourceIp: string;
  details?: string;
}

export function AuditLogs() {
  const [logs] = useState<AuditLog[]>([
    {
      id: '1',
      timestamp: '2026-05-14 10:00:00',
      actor: 'admin',
      role: 'Admin',
      action: 'login',
      resource: '-',
      result: 'success',
      sourceIp: '192.168.1.50',
    },
    {
      id: '2',
      timestamp: '2026-05-14 10:05:23',
      actor: 'admin',
      role: 'Admin',
      action: 'create_route',
      resource: '/api/products',
      result: 'success',
      sourceIp: '192.168.1.50',
      details: 'Created route to http://localhost:3003/products',
    },
    {
      id: '3',
      timestamp: '2026-05-14 10:10:15',
      actor: 'operator1',
      role: 'Operator',
      action: 'login',
      resource: '-',
      result: 'success',
      sourceIp: '192.168.1.51',
    },
    {
      id: '4',
      timestamp: '2026-05-14 10:12:45',
      actor: 'operator1',
      role: 'Operator',
      action: 'generate_key',
      resource: 'Mobile App',
      result: 'success',
      sourceIp: '192.168.1.51',
      details: 'Generated API key for Mobile App',
    },
    {
      id: '5',
      timestamp: '2026-05-14 10:15:30',
      actor: 'viewer1',
      role: 'Viewer',
      action: 'create_route',
      resource: '/api/test',
      result: 'failure',
      sourceIp: '192.168.1.52',
      details: 'Access denied: insufficient permissions',
    },
    {
      id: '6',
      timestamp: '2026-05-14 10:20:00',
      actor: 'admin',
      role: 'Admin',
      action: 'delete_route',
      resource: '/api/old-endpoint',
      result: 'success',
      sourceIp: '192.168.1.50',
    },
    {
      id: '7',
      timestamp: '2026-05-14 10:25:12',
      actor: 'admin',
      role: 'Admin',
      action: 'create_user',
      resource: 'operator2',
      result: 'success',
      sourceIp: '192.168.1.50',
      details: 'Created user with Operator role',
    },
    {
      id: '8',
      timestamp: '2026-05-14 10:30:00',
      actor: 'operator1',
      role: 'Operator',
      action: 'revoke_key',
      resource: 'Test Environment',
      result: 'success',
      sourceIp: '192.168.1.51',
    },
  ]);

  const [searchTerm, setSearchTerm] = useState('');
  const [actorFilter, setActorFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');

  const actors = Array.from(new Set(logs.map((log) => log.actor)));

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.resource.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.sourceIp.includes(searchTerm) ||
      (log.details && log.details.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesActor = actorFilter === 'all' || log.actor === actorFilter;
    const matchesResult = resultFilter === 'all' || log.result === resultFilter;

    return matchesSearch && matchesActor && matchesResult;
  });

  const getResultBadge = (result: 'success' | 'failure') => {
    if (result === 'success') {
      return (
        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border flex items-center gap-1 w-fit">
          <CheckCircle2 className="w-3 h-3" />
          Success
        </Badge>
      );
    }
    return (
      <Badge className="bg-red-500/10 text-red-400 border-red-500/20 border flex items-center gap-1 w-fit">
        <XCircle className="w-3 h-3" />
        Failure
      </Badge>
    );
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'Admin':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'Operator':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'Viewer':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const successCount = logs.filter((l) => l.result === 'success').length;
  const failureCount = logs.filter((l) => l.result === 'failure').length;

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Audit Logs</h1>
        <p className="text-muted-foreground">
          Nhật ký ghi lại các hành động quản trị trên hệ thống
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Total Actions
            </h3>
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Shield className="w-5 h-5 text-blue-500" />
            </div>
          </div>
          <p className="text-3xl font-bold text-white">{logs.length}</p>
        </Card>
        <Card className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Success
            </h3>
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
          <p className="text-3xl font-bold text-white">{successCount}</p>
        </Card>
        <Card className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Failures
            </h3>
            <div className="p-2 bg-red-500/10 rounded-lg">
              <XCircle className="w-5 h-5 text-red-500" />
            </div>
          </div>
          <p className="text-3xl font-bold text-white">{failureCount}</p>
        </Card>
      </div>

      <Card className="rounded-2xl bg-card/80 backdrop-blur-sm border-border p-6 mb-6">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Tìm kiếm theo action, resource, IP..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-input border-border text-foreground"
              />
            </div>
          </div>
          <Select value={actorFilter} onValueChange={setActorFilter}>
            <SelectTrigger className="w-[150px] bg-input border-border text-foreground">
              <SelectValue placeholder="Actor" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">All Actors</SelectItem>
              {actors.map((actor) => (
                <SelectItem key={actor} value={actor}>
                  {actor}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={resultFilter} onValueChange={setResultFilter}>
            <SelectTrigger className="w-[150px] bg-input border-border text-foreground">
              <SelectValue placeholder="Result" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">All Results</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failure">Failure</SelectItem>
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
            Audit Logs ({filteredLogs.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Actor</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Resource</th>
                <th className="px-6 py-4">Result</th>
                <th className="px-6 py-4">Source IP</th>
                <th className="px-6 py-4">Details</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="border-b border-border/50 hover:bg-primary/5">
                  <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                    {log.timestamp}
                  </td>
                  <td className="px-6 py-4 text-slate-300 font-medium">{log.actor}</td>
                  <td className="px-6 py-4">
                    <Badge className={`${getRoleBadgeClass(log.role)} border text-xs`}>
                      {log.role}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-slate-300 font-mono text-xs">{log.action}</td>
                  <td className="px-6 py-4 text-slate-400 text-xs">{log.resource}</td>
                  <td className="px-6 py-4">{getResultBadge(log.result)}</td>
                  <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                    {log.sourceIp}
                  </td>
                  <td className="px-6 py-4 text-slate-500 text-xs max-w-xs truncate">
                    {log.details || '-'}
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">
                    Không tìm thấy audit logs phù hợp với bộ lọc
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
