import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import { StatsCard } from '../components/dashboard/StatsCard';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../components/ui/chart';
import {
  Key,
  ListOrdered,
  RefreshCw,
  Route,
  ShieldCheck,
} from 'lucide-react';
import {
  ApiClientError,
  fetchDashboardStats,
  fetchGatewayRoutes,
  fetchProxyQueue,
  type DashboardStats,
} from '../../lib/api';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import type { GatewayRouteRow } from '../../lib/gatewayRoutes';
import { formatDbTimestamp } from '../../lib/formatDbTimestamp';
import { OverviewGuest } from './OverviewGuest';
import { TechPageHeader } from '../components/tech/TechPageHeader';

const CHART_COLORS = ['#3b82f6', '#f97316', '#a855f7', '#10b981', '#fb923c'];

const AXIS_TICK = '#94a3b8';
const GRID_STROKE = '#334155';

const countBarConfig = {
  count: { label: 'Số lượng', color: CHART_COLORS[0] },
} satisfies ChartConfig;

const auditPieConfig = {
  count: { label: 'Sự kiện', color: CHART_COLORS[0] },
} satisfies ChartConfig;

const auditHourlyConfig = {
  count: { label: 'Sự kiện audit', color: CHART_COLORS[0] },
} satisfies ChartConfig;

const ACTION_VI: Record<string, string> = {
  admin_login: 'Đăng nhập admin',
  admin_logout: 'Đăng xuất',
  route_create: 'Tạo route',
  route_update: 'Sửa route',
  route_delete: 'Xóa route',
  client_key_create: 'Tạo API key',
  client_key_delete: 'Xóa API key',
  proxy_queue_retry: 'Retry DLQ',
};

function integrationStatusBadge(status: string) {
  switch (status) {
    case 'connected':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'pending':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'error':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    default:
      return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  }
}

function OverviewAdmin() {
  const { user } = useAdminAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [routes, setRoutes] = useState<GatewayRouteRow[]>([]);
  const [proxyQueueLen, setProxyQueueLen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [dash, routeRows, queue] = await Promise.all([
        fetchDashboardStats(),
        fetchGatewayRoutes(),
        fetchProxyQueue().catch(() => []),
      ]);
      setStats(dash);
      setRoutes(routeRows);
      setProxyQueueLen(queue.length);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      const status = e instanceof ApiClientError ? e.status : 0;
      if (status !== 401) toast.error('Không tải được dashboard');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const audit = stats?.audit_24h;

  const auditPieData = useMemo(() => {
    if (!audit?.total) return [];
    const rows = [
      { name: 'Thành công', count: audit.success },
      { name: 'Lỗi', count: audit.failure },
    ];
    return rows.filter((r) => r.count > 0);
  }, [audit]);

  const auditActionsData = useMemo(
    () =>
      (stats?.audit_top_actions ?? []).map((a) => ({
        label: ACTION_VI[a.label] ?? a.label,
        count: a.count,
      })),
    [stats]
  );

  const routeConfigData = useMemo(() => {
    const queue = routes.filter((r) => (r.queue_on_failure ?? 0) !== 0).length;
    const retry = routes.filter((r) => (r.retry_max ?? 0) > 0).length;
    return [
      { label: 'Tổng route', count: routes.length },
      { label: 'Queue khi lỗi', count: queue },
      { label: 'Bật retry', count: retry },
    ];
  }, [routes]);

  const auditHourlyData = useMemo(
    () =>
      (stats?.audit_hourly ?? []).map((h) => ({
        time: h.label,
        count: h.count,
      })),
    [stats]
  );

  const connectedIntegrations = useMemo(
    () => (stats?.integrations ?? []).filter((i) => i.status === 'connected').length,
    [stats]
  );

  return (
    <>
      <TechPageHeader
        codeLine="// dashboard · live metrics"
        title="Tổng quan"
        description="Vận hành gateway: route, API key, audit admin, hàng đợi proxy (DLQ)."
        actions={
          <Button variant="outline" className="border-border font-mono-tech text-xs" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            refresh
          </Button>
        }
      />

      {loadError ? (
        <Card className="mb-6 p-4 border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">{loadError}</Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          icon={<Route className="text-purple-500" />}
          iconBg="bg-purple-500/10"
          title="Routes"
          value={loading ? '…' : String(stats?.routes_count ?? routes.length)}
          badge={{ text: 'Data plane', variant: 'info' }}
        />
        <StatsCard
          icon={<Key className="text-violet-500" />}
          iconBg="bg-violet-500/10"
          title="Client API keys"
          value={loading ? '…' : String(stats?.client_keys_count ?? 0)}
          badge={{ text: 'HMAC', variant: 'info' }}
        />
        <StatsCard
          icon={<ShieldCheck className="text-emerald-500" />}
          iconBg="bg-emerald-500/10"
          title="Audit 24h"
          value={loading ? '…' : String(audit?.total ?? 0)}
          badge={{
            text: audit ? `${audit.success} ok / ${audit.failure} lỗi` : '—',
            variant: audit && audit.failure > 0 ? 'warning' : 'success',
          }}
        />
        <StatsCard
          icon={<ListOrdered className="text-amber-500" />}
          iconBg="bg-amber-500/10"
          title="Proxy queue (DLQ)"
          value={loading ? '…' : String(proxyQueueLen)}
          badge={{
            text: proxyQueueLen > 0 ? 'Cần xử lý' : 'Trống',
            variant: proxyQueueLen > 0 ? 'warning' : 'success',
          }}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 lg:gap-8 mb-8">
        <Card className="p-4 sm:p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">
            Audit 24h — kết quả
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Hành động admin trên gateway (đăng nhập, route, key…).
          </p>
          {auditPieData.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa có audit 24h. Thao tác trên{' '}
              <Link to="/audit" className="text-primary underline">
                Nhật ký
              </Link>{' '}
              sẽ hiện ở đây.
            </p>
          ) : (
            <ChartContainer config={auditPieConfig} className="h-[240px] sm:h-[260px] w-full aspect-auto">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                <Pie
                  data={auditPieData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={3}
                  stroke="#0f172a"
                  strokeWidth={2}
                >
                  {auditPieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
        </Card>

        <Card className="p-4 sm:p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">
            Audit — hành động nhiều nhất
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Top 8 action trong 24 giờ qua.</p>
          {auditActionsData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p>
          ) : (
            <ChartContainer config={countBarConfig} className="h-[240px] sm:h-[260px] w-full aspect-auto">
              <BarChart data={auditActionsData} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={56}
                  tick={{ fill: AXIS_TICK }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  allowDecimals={false}
                  tick={{ fill: AXIS_TICK }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} fill={CHART_COLORS[0]} />
              </BarChart>
            </ChartContainer>
          )}
        </Card>

        <Card className="p-4 sm:p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">
            Cấu hình routes
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Retry / queue-on-failure — tính năng gateway thực tế.
          </p>
          {routes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa có route.{' '}
              <Link to="/routes" className="text-primary underline">
                Thêm route
              </Link>
              .
            </p>
          ) : (
            <ChartContainer config={countBarConfig} className="h-[240px] sm:h-[260px] w-full aspect-auto">
              <BarChart data={routeConfigData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  interval={0}
                  tick={{ fill: AXIS_TICK }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  allowDecimals={false}
                  tick={{ fill: AXIS_TICK }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {routeConfigData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </Card>

        <Card className="p-4 sm:p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">
            Audit theo giờ (24h)
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Mật độ sự kiện admin theo giờ trong ngày.</p>
          {auditHourlyData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có audit trong 24h.</p>
          ) : (
            <ChartContainer config={auditHourlyConfig} className="h-[240px] sm:h-[260px] w-full aspect-auto">
              <LineChart data={auditHourlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  tick={{ fill: AXIS_TICK }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  allowDecimals={false}
                  tick={{ fill: AXIS_TICK }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CHART_COLORS[0] }}
                />
              </LineChart>
            </ChartContainer>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2">
          <Card className="rounded-2xl overflow-hidden bg-card/80 border-border">
            <div className="p-6 border-b border-border flex justify-between items-center">
              <h3 className="font-bold text-white text-sm uppercase tracking-wider">Routes</h3>
              <Button size="sm" variant="outline" className="border-border" onClick={() => void load()}>
                Reload
              </Button>
            </div>
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3">Path</th>
                    <th className="px-6 py-3">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.id} className="border-b border-border/50">
                      <td className="px-6 py-3 font-mono text-xs text-slate-300">{route.path}</td>
                      <td className="px-6 py-3 text-slate-400 truncate max-w-xs">{route.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card className="rounded-2xl p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">Tích hợp CRM</h3>
          <p className="text-xs text-muted-foreground mb-4">
            {connectedIntegrations} / {stats?.integrations.length ?? 0} đã kết nối — chi tiết snapshot ở trang Tích hợp.
          </p>
          <div className="space-y-4">
            {(stats?.integrations ?? []).map((row) => (
              <div key={row.provider} className="border border-border rounded-lg p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium text-white text-sm">{row.label}</span>
                  <Badge className={`${integrationStatusBadge(row.status)} border text-xs`}>{row.status}</Badge>
                </div>
                {row.last_sync_at ? (
                  <p className="text-xs text-muted-foreground">Sync: {formatDbTimestamp(row.last_sync_at)}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Chưa sync</p>
                )}
              </div>
            ))}
            <Link to="/integrations">
              <Button variant="outline" className="w-full border-border" size="sm">
                Quản lý tích hợp
              </Button>
            </Link>
            {proxyQueueLen > 0 ? (
              <Link to="/proxy-queue">
                <Button variant="outline" className="w-full border-amber-500/40 text-amber-300" size="sm">
                  Xem proxy queue ({proxyQueueLen})
                </Button>
              </Link>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}

export function Overview() {
  const { user, loading } = useAdminAuth();

  if (loading) {
    return <p className="text-sm text-muted-foreground">Đang tải…</p>;
  }

  if (!user) return <OverviewGuest />;

  return <OverviewAdmin />;
}
