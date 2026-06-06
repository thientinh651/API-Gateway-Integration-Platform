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
  Activity,
  AlertTriangle,
  Key,
  ListOrdered,
  RefreshCw,
  Route,
  ShieldX,
  Timer,
} from 'lucide-react';
import {
  ApiClientError,
  fetchDashboardStats,
  fetchGatewayRoutes,
  fetchProxyQueue,
  type DashboardStats,
} from '../../lib/api';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { canManageIntegrations } from '../../lib/rbac';
import type { GatewayRouteRow } from '../../lib/gatewayRoutes';
import { formatDbTimestamp } from '../../lib/formatDbTimestamp';
import { OverviewGuest } from './OverviewGuest';
import { TechPageHeader } from '../components/tech/TechPageHeader';

const CHART_COLORS = ['#10b981', '#3b82f6', '#f97316', '#ef4444', '#a855f7', '#fb923c'];

const AXIS_TICK = '#94a3b8';
const GRID_STROKE = '#334155';

const countBarConfig = {
  count: { label: 'Số lượng', color: CHART_COLORS[1] },
} satisfies ChartConfig;

const trafficPieConfig = {
  count: { label: 'Kết nối', color: CHART_COLORS[0] },
} satisfies ChartConfig;

const trafficHourlyConfig = {
  count: { label: 'Kết nối', color: CHART_COLORS[1] },
} satisfies ChartConfig;

const STATUS_VI: Record<string, string> = {
  '2xx': '2xx Thành công',
  '3xx': '3xx Chuyển hướng',
  '4xx': '4xx Client',
  '5xx': '5xx Server',
  other: 'Khác',
};

const OUTCOME_VI: Record<string, string> = {
  success: 'Thành công',
  denied: 'Từ chối',
  upstream_error: 'Lỗi upstream',
  queued: 'Xếp hàng DLQ',
};

const INTEGRATION_STATUS_VI: Record<string, string> = {
  connected: 'Đã kết nối',
  pending: 'Chờ cấu hình',
  error: 'Lỗi',
  disconnected: 'Ngắt kết nối',
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

function truncatePath(path: string, max = 28) {
  if (path.length <= max) return path;
  return `${path.slice(0, max - 1)}…`;
}

function OverviewAdmin() {
  const { user } = useAdminAuth();
  const showIntegrations = canManageIntegrations(user);
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

  const traffic = stats?.traffic_24h;

  const httpStatusPieData = useMemo(
    () =>
      (stats?.traffic_status_buckets ?? [])
        .filter((b) => b.count > 0)
        .map((b) => ({
          name: STATUS_VI[b.label] ?? b.label,
          count: b.count,
        })),
    [stats]
  );

  const outcomePieData = useMemo(() => {
    if (!traffic?.total) return [];
    const rows = [
      { key: 'success', count: traffic.success },
      { key: 'denied', count: traffic.denied },
      { key: 'upstream_error', count: traffic.upstream_error },
      { key: 'queued', count: traffic.queued },
    ];
    return rows
      .filter((r) => r.count > 0)
      .map((r) => ({ name: OUTCOME_VI[r.key] ?? r.key, count: r.count }));
  }, [traffic]);

  const trafficHourlyData = useMemo(
    () =>
      (stats?.traffic_hourly ?? []).map((h) => ({
        time: h.label,
        count: h.count,
      })),
    [stats]
  );

  const topPathsData = useMemo(
    () =>
      (stats?.traffic_top_paths ?? []).map((p) => ({
        label: truncatePath(p.label),
        fullPath: p.label,
        count: p.count,
      })),
    [stats]
  );

  const methodData = useMemo(
    () =>
      (stats?.traffic_methods ?? []).map((m) => ({
        label: m.label,
        count: m.count,
      })),
    [stats]
  );

  const integrationPieData = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stats?.integrations ?? []) {
      const label = INTEGRATION_STATUS_VI[row.status] ?? row.status;
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return [...map.entries()].map(([name, count]) => ({ name, count }));
  }, [stats]);

  const successRate =
    traffic && traffic.total > 0 ? Math.round((traffic.success / traffic.total) * 100) : null;

  return (
    <>
      <TechPageHeader
        codeLine="// dashboard · traffic · 24h"
        title="Tổng quan"
        description="Kết nối API qua gateway: số lượng, HTTP status, từ chối/lỗi upstream, tích hợp CRM."
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
          icon={<Activity className="text-blue-500" />}
          iconBg="bg-blue-500/10"
          title="Kết nối API 24h"
          value={loading ? '…' : String(traffic?.total ?? 0)}
          badge={{
            text: successRate != null ? `${successRate}% thành công` : '—',
            variant: successRate != null && successRate >= 90 ? 'success' : 'info',
          }}
        />
        <StatsCard
          icon={<Route className="text-emerald-500" />}
          iconBg="bg-emerald-500/10"
          title="Thành công"
          value={loading ? '…' : String(traffic?.success ?? 0)}
          badge={{ text: 'outcome: success', variant: 'success' }}
        />
        <StatsCard
          icon={<ShieldX className="text-amber-500" />}
          iconBg="bg-amber-500/10"
          title="Từ chối / lỗi"
          value={loading ? '…' : String((traffic?.denied ?? 0) + (traffic?.upstream_error ?? 0))}
          badge={{
            text: traffic
              ? `${traffic.denied} từ chối · ${traffic.upstream_error} upstream`
              : '—',
            variant: traffic && traffic.denied + traffic.upstream_error > 0 ? 'warning' : 'success',
          }}
        />
        <StatsCard
          icon={<ListOrdered className="text-red-500" />}
          iconBg="bg-red-500/10"
          title="DLQ / Queue"
          value={loading ? '…' : String((traffic?.queued ?? 0) + proxyQueueLen)}
          badge={{
            text:
              proxyQueueLen > 0
                ? `${proxyQueueLen} chờ retry`
                : traffic?.queued
                  ? `${traffic.queued} queued 24h`
                  : 'Trống',
            variant: proxyQueueLen > 0 || (traffic?.queued ?? 0) > 0 ? 'warning' : 'success',
          }}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card className="p-4 bg-card/80 border-border">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
            <Timer className="w-3.5 h-3.5" />
            Latency TB
          </div>
          <p className="text-2xl font-bold text-white">
            {loading ? '…' : `${traffic?.avg_duration_ms ?? 0} ms`}
          </p>
        </Card>
        <Card className="p-4 bg-card/80 border-border">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
            <Route className="w-3.5 h-3.5" />
            Routes
          </div>
          <p className="text-2xl font-bold text-white">{loading ? '…' : String(stats?.routes_count ?? routes.length)}</p>
        </Card>
        <Card className="p-4 bg-card/80 border-border">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
            <Key className="w-3.5 h-3.5" />
            API keys
          </div>
          <p className="text-2xl font-bold text-white">{loading ? '…' : String(stats?.client_keys_count ?? 0)}</p>
        </Card>
        <Card className="p-4 bg-card/80 border-border">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Audit admin 24h
          </div>
          <p className="text-2xl font-bold text-white">{loading ? '…' : String(stats?.audit_24h.total ?? 0)}</p>
          <Link to="/logs?kind=admin" className="text-xs text-primary underline mt-1 inline-block">
            Xem audit
          </Link>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 lg:gap-8 mb-8">
        <Card className="p-4 sm:p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">
            HTTP status (24h)
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Phân bố mã phản hồi: 2xx OK, 4xx client (401/404…), 5xx upstream.
          </p>
          {httpStatusPieData.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa có kết nối. Thử{' '}
              <Link to="/proxy-try" className="text-primary underline">
                gọi proxy
              </Link>{' '}
              hoặc client thật qua gateway.
            </p>
          ) : (
            <ChartContainer config={trafficPieConfig} className="h-[240px] sm:h-[260px] w-full aspect-auto">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                <Pie
                  data={httpStatusPieData}
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
                  {httpStatusPieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
        </Card>

        <Card className="p-4 sm:p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">
            Kết quả kết nối (24h)
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Gateway xử lý: thành công, từ chối auth/rate-limit, lỗi upstream, xếp hàng DLQ.
          </p>
          {outcomePieData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p>
          ) : (
            <ChartContainer config={trafficPieConfig} className="h-[240px] sm:h-[260px] w-full aspect-auto">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                <Pie
                  data={outcomePieData}
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
                  {outcomePieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
        </Card>

        <Card className="p-4 sm:p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">
            Kết nối theo giờ (24h)
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Mật độ request API qua gateway.</p>
          {trafficHourlyData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có traffic trong 24h.</p>
          ) : (
            <ChartContainer config={trafficHourlyConfig} className="h-[240px] sm:h-[260px] w-full aspect-auto">
              <LineChart data={trafficHourlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                  stroke={CHART_COLORS[1]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CHART_COLORS[1] }}
                />
              </LineChart>
            </ChartContainer>
          )}
        </Card>

        <Card className="p-4 sm:p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">
            Top path (24h)
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Endpoint được gọi nhiều nhất.</p>
          {topPathsData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có path nào.</p>
          ) : (
            <ChartContainer config={countBarConfig} className="h-[240px] sm:h-[260px] w-full aspect-auto">
              <BarChart data={topPathsData} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
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
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) =>
                        payload?.[0]?.payload?.fullPath ?? payload?.[0]?.payload?.label
                      }
                    />
                  }
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} fill={CHART_COLORS[1]} />
              </BarChart>
            </ChartContainer>
          )}
        </Card>

        <Card className="p-4 sm:p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">
            Method HTTP (24h)
          </h3>
          <p className="text-xs text-muted-foreground mb-4">GET, POST, PUT…</p>
          {methodData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p>
          ) : (
            <ChartContainer config={countBarConfig} className="h-[240px] sm:h-[260px] w-full aspect-auto">
              <BarChart data={methodData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
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
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {methodData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </Card>

        {showIntegrations ? (
          <Card className="p-4 sm:p-6 bg-card/80 border-border">
            <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">
              Tích hợp CRM — trạng thái
            </h3>
            <p className="text-xs text-muted-foreground mb-4">Salesforce / Zoho OAuth connection.</p>
            {integrationPieData.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Chưa cấu hình.{' '}
                <Link to="/integrations" className="text-primary underline">
                  Tích hợp
                </Link>
                .
              </p>
            ) : (
              <ChartContainer config={trafficPieConfig} className="h-[240px] sm:h-[260px] w-full aspect-auto">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Pie
                    data={integrationPieData}
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
                    {integrationPieData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            )}
          </Card>
        ) : null}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2">
          <Card className="rounded-2xl overflow-hidden bg-card/80 border-border">
            <div className="p-6 border-b border-border flex justify-between items-center">
              <h3 className="font-bold text-white text-sm uppercase tracking-wider">Routes</h3>
              <Link to="/logs">
                <Button size="sm" variant="outline" className="border-border">
                  Log traffic
                </Button>
              </Link>
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

        {showIntegrations ? (
          <Card className="rounded-2xl p-6 bg-card/80 border-border">
            <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-1">Tích hợp</h3>
            <p className="text-xs text-muted-foreground mb-4">Chi tiết kết nối OAuth.</p>
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
                    DLQ ({proxyQueueLen})
                  </Button>
                </Link>
              ) : null}
            </div>
          </Card>
        ) : proxyQueueLen > 0 ? (
          <Card className="rounded-2xl p-6 bg-card/80 border-border">
            <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">DLQ</h3>
            <Link to="/proxy-queue">
              <Button variant="outline" className="w-full border-amber-500/40 text-amber-300" size="sm">
                Hàng đợi ({proxyQueueLen})
              </Button>
            </Link>
          </Card>
        ) : null}
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
