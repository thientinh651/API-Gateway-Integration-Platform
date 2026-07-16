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
import { NavCard } from '../components/dashboard/NavCard';
import { StatsCard } from '../components/dashboard/StatsCard';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
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
  countDlqByStatus,
  fetchProxyQueue,
  type DashboardStats,
  type ProxyQueueItem,
} from '../../lib/api';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { canManageIntegrations } from '../../lib/rbac';
import type { GatewayRouteRow } from '../../lib/gatewayRoutes';
import { formatDbTimestamp } from '../../lib/formatDbTimestamp';
import { reasonLabel } from '../../lib/middlewareLabels';
import { OverviewGuest } from './OverviewGuest';
import { TechPageHeader } from '../components/tech/TechPageHeader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useMediaQuery } from '../../hooks/useMediaQuery';

const CHART_COLORS = ['#10b981', '#3b82f6', '#f97316', '#ef4444', '#a855f7', '#fb923c'];

const SYNC_WORKER_CLIENT_NAME = 'avaso_pk_sync_worker';

const DASHBOARD_RANGES = [
  { hours: 1, label: '1 giờ' },
  { hours: 24, label: '1 ngày' },
  { hours: 72, label: '3 ngày' },
  { hours: 168, label: '1 tuần' },
] as const;

type DashboardRangeHours = (typeof DASHBOARD_RANGES)[number]['hours'];

function rangeLabel(hours: number): string {
  return DASHBOARD_RANGES.find((r) => r.hours === hours)?.label ?? `${hours}h`;
}

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

const ACTIVE_INTEGRATION_PROVIDERS = new Set(['salesforce', 'zoho_projects']);

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

function OverviewCrmIntegrationsCard({
  integrations,
  snapshotEntities,
}: {
  integrations: DashboardStats['integrations'];
  snapshotEntities: DashboardStats['snapshot_entities'];
}) {
  return (
    <NavCard to="/integrations" className="p-4 sm:p-6 bg-card/80 border-border" ariaLabel="Tích hợp CRM">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h3 className="font-bold text-white text-sm uppercase tracking-wider">Tích hợp CRM</h3>
        <span className="text-xs text-primary font-mono-tech shrink-0">Mở →</span>
      </div>
      {integrations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa kết nối provider.</p>
      ) : (
        <div className="space-y-3">
          {integrations.map((row) => {
            const snapshots = snapshotEntities.filter((s) => s.provider === row.provider);
            return (
              <div key={row.provider} className="rounded-xl border border-border bg-slate-900/35 p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-medium text-white text-sm">{row.label}</span>
                  <Badge className={`${integrationStatusBadge(row.status)} border text-xs shrink-0`}>
                    {INTEGRATION_STATUS_VI[row.status] ?? row.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {row.last_sync_at
                    ? formatDbTimestamp(row.last_sync_at)
                    : 'Chưa sync'}
                </p>
                {row.last_error && row.status === 'error' ? (
                  <p className="text-xs text-red-300/90 mt-2 line-clamp-2" title={row.last_error}>
                    {row.last_error}
                  </p>
                ) : null}
                {snapshots.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {snapshots.map((s) => (
                      <Badge
                        key={`${s.provider}-${s.entity_type}`}
                        variant="outline"
                        className="text-[10px] border-border/80 text-slate-400"
                      >
                        {s.label}: {s.record_count}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </NavCard>
  );
}

function truncatePath(path: string, max = 28) {
  if (path.length <= max) return path;
  return `${path.slice(0, max - 1)}…`;
}

function MiniCountList({ rows }: { rows: Array<{ name: string; count: number }> }) {
  return (
    <ul className="space-y-2 text-xs">
      {rows.map((r) => (
        <li key={r.name} className="flex justify-between gap-2 text-slate-300">
          <span className="truncate">{r.name}</span>
          <span className="font-mono text-cyan-400 shrink-0">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function OverviewAdmin() {
  const { user } = useAdminAuth();
  const isMobile = useMediaQuery('(max-width: 639px)');
  const showIntegrations = canManageIntegrations(user);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [routes, setRoutes] = useState<GatewayRouteRow[]>([]);
  const [proxyQueueItems, setProxyQueueItems] = useState<ProxyQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rangeHours, setRangeHours] = useState<DashboardRangeHours>(24);
  const win = rangeLabel(rangeHours);
  const dataReady =
    !loading && stats != null && (stats.window_hours == null || stats.window_hours === rangeHours);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [dash, routeRows, queue] = await Promise.all([
        fetchDashboardStats(rangeHours),
        fetchGatewayRoutes(),
        fetchProxyQueue().catch(() => []),
      ]);
      setStats(dash);
      setRoutes(routeRows);
      setProxyQueueItems(queue);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      const status = e instanceof ApiClientError ? e.status : 0;
      if (status !== 401) toast.error('Không tải được dashboard');
    } finally {
      setLoading(false);
    }
  }, [user, rangeHours]);

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

  const denialReasonData = useMemo(
    () =>
      (stats?.traffic_denial_reasons ?? []).map((r) => ({
        code: r.label,
        label: reasonLabel(r.label),
        count: r.count,
      })),
    [stats],
  );

  const clientTrafficTop = useMemo(
    () => stats?.client_traffic_top ?? [],
    [stats],
  );

  const dlqCounts = useMemo(() => countDlqByStatus(proxyQueueItems), [proxyQueueItems]);

  const integrationRows = useMemo(
    () => (stats?.integrations ?? []).filter((r) => ACTIVE_INTEGRATION_PROVIDERS.has(r.provider)),
    [stats?.integrations],
  );

  const successRate =
    traffic && traffic.total > 0 ? Math.round((traffic.success / traffic.total) * 100) : null;

  return (
    <>
      <TechPageHeader
        codeLine={`// dashboard · ${win}`}
        title="Tổng quan"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={String(rangeHours)}
              onValueChange={(v) => setRangeHours(Number(v) as DashboardRangeHours)}
            >
              <SelectTrigger className="w-[140px] bg-input border-border font-mono-tech text-xs h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {DASHBOARD_RANGES.map((r) => (
                  <SelectItem key={r.hours} value={String(r.hours)} className="font-mono-tech text-xs">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="border-border font-mono-tech text-xs"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              refresh
            </Button>
          </div>
        }
      />

      {loadError ? (
        <Card className="mb-6 p-4 border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">{loadError}</Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          to="/logs?kind=traffic"
          icon={<Activity className="text-blue-500" />}
          iconBg="bg-blue-500/10"
          title="Kết nối API"
          value={dataReady ? String(traffic?.total ?? 0) : '…'}
          badge={
            dataReady && successRate != null
              ? {
                  text: `${successRate}% thành công`,
                  variant: successRate >= 90 ? 'success' : 'info',
                }
              : undefined
          }
        />
        <StatsCard
          to="/logs?kind=traffic&result=success"
          icon={<Route className="text-emerald-500" />}
          iconBg="bg-emerald-500/10"
          title="Thành công"
          value={dataReady ? String(traffic?.success ?? 0) : '…'}
        />
        <StatsCard
          to="/logs?kind=traffic&result=failure"
          icon={<ShieldX className="text-amber-500" />}
          iconBg="bg-amber-500/10"
          title="Từ chối / lỗi"
          value={
            dataReady
              ? String((traffic?.denied ?? 0) + (traffic?.upstream_error ?? 0))
              : '…'
          }
        />
        <StatsCard
          to="/proxy-queue"
          icon={<ListOrdered className="text-red-500" />}
          iconBg="bg-red-500/10"
          title="DLQ / Queue"
          value={dataReady ? String(dlqCounts.total || (traffic?.queued ?? 0)) : '…'}
          badge={
            dataReady && dlqCounts.total > 0
              ? {
                  text: `${dlqCounts.pending} pending · ${dlqCounts.replayed} replayed`,
                  variant: dlqCounts.pending > 0 ? 'warning' : 'success',
                }
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 items-stretch">
        <NavCard to="/logs?kind=traffic" className="p-4 bg-card/80 border-border h-full flex flex-col" ariaLabel="Latency gateway">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
            <Timer className="w-3.5 h-3.5 shrink-0" />
            Latency TB
          </div>
          <p className="text-2xl font-bold text-white">
            {dataReady ? `${traffic?.avg_duration_ms ?? 0} ms` : '…'}
          </p>
          <p className="text-xs text-muted-foreground mt-1 min-h-[1rem]" aria-hidden>
            {'\u00a0'}
          </p>
        </NavCard>
        <NavCard to="/routes" className="p-4 bg-card/80 border-border h-full flex flex-col" ariaLabel="Routes">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
            <Route className="w-3.5 h-3.5" />
            Routes
          </div>
          <p className="text-2xl font-bold text-white">
            {dataReady ? String(stats?.routes_count ?? routes.length) : '…'}
          </p>
          <p className="text-xs text-muted-foreground mt-1 min-h-[1rem]" aria-hidden>
            {'\u00a0'}
          </p>
        </NavCard>
        <NavCard to="/auth" className="p-4 bg-card/80 border-border h-full flex flex-col" ariaLabel="Client Registry">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
            <Key className="w-3.5 h-3.5" />
            Client Registry
          </div>
          <p className="text-2xl font-bold text-white">
            {dataReady ? String(stats?.client_keys_count ?? 0) : '…'}
          </p>
          <p className="text-xs text-muted-foreground mt-1 min-h-[1rem]">
            {dataReady && stats?.client_registry
              ? `${stats.client_registry.active} active · ${stats.client_registry.disabled} tắt`
              : '\u00a0'}
          </p>
        </NavCard>
        <NavCard to="/logs?kind=admin" className="p-4 bg-card/80 border-border h-full flex flex-col" ariaLabel="Audit admin">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Audit admin
          </div>
          <p className="text-2xl font-bold text-white">
            {dataReady ? String(stats?.audit_24h.total ?? 0) : '…'}
          </p>
          <p className="text-xs text-muted-foreground mt-1 min-h-[1rem]" aria-hidden>
            {'\u00a0'}
          </p>
        </NavCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 lg:gap-8 mb-8 min-w-0">
        <NavCard to="/logs?kind=traffic" className="p-4 sm:p-6 bg-card/80 border-border min-w-0" ariaLabel="HTTP status">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">HTTP status</h3>
          {!dataReady ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : httpStatusPieData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có kết nối.</p>
          ) : isMobile ? (
            <MiniCountList rows={httpStatusPieData} />
          ) : (
            <ChartContainer key={`status-${rangeHours}`} config={trafficPieConfig} className="h-[240px] sm:h-[260px] w-full">
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
        </NavCard>

        <NavCard to="/logs?kind=traffic" className="p-4 sm:p-6 bg-card/80 border-border" ariaLabel="Kết quả kết nối">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Kết quả kết nối</h3>
          {!dataReady ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : outcomePieData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p>
          ) : isMobile ? (
            <MiniCountList rows={outcomePieData} />
          ) : (
            <ChartContainer key={`outcome-${rangeHours}`} config={trafficPieConfig} className="h-[240px] sm:h-[260px] w-full">
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
        </NavCard>

        <NavCard to="/logs?kind=traffic&result=failure" className="p-4 sm:p-6 bg-card/80 border-border" ariaLabel="Từ chối middleware">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Từ chối middleware</h3>
          {!dataReady ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : denialReasonData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có từ chối.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {denialReasonData.map((r) => (
                <li key={r.code} className="flex justify-between gap-2 text-slate-300">
                  <Link
                    to={`/logs?kind=traffic&reason=${encodeURIComponent(r.code)}`}
                    className="truncate hover:text-primary hover:underline"
                  >
                    {r.label}
                  </Link>
                  <span className="font-mono text-amber-400 shrink-0">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </NavCard>

        <NavCard to="/auth" className="p-4 sm:p-6 bg-card/80 border-border" ariaLabel="Top clients">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Top client</h3>
          {!dataReady ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : clientTrafficTop.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có traffic.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {clientTrafficTop.map((c) => {
                const isSyncWorker = c.name === SYNC_WORKER_CLIENT_NAME;
                const pct =
                  traffic && traffic.total > 0
                    ? Math.round((c.total / traffic.total) * 100)
                    : null;
                return (
                  <li key={c.client_key_id} className="flex justify-between gap-2 text-slate-300">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Link
                        to={`/logs?kind=traffic&client_key_id=${c.client_key_id}`}
                        className="truncate hover:text-primary hover:underline"
                        title={c.name}
                      >
                        {c.name}
                      </Link>
                      {isSyncWorker ? (
                        <Badge className="shrink-0 border border-violet-500/30 bg-violet-500/10 px-1.5 py-0 text-[10px] text-violet-300">
                          Sync Worker
                        </Badge>
                      ) : null}
                    </span>
                    <span className="font-mono text-cyan-400 shrink-0">
                      {c.total}
                      {pct != null ? ` · ${pct}%` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </NavCard>

        <NavCard to="/logs?kind=traffic" className="p-4 sm:p-6 bg-card/80 border-border" ariaLabel="Theo thời gian">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Theo thời gian</h3>
          {!dataReady ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : trafficHourlyData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có traffic.</p>
          ) : isMobile ? (
            <MiniCountList rows={trafficHourlyData.map((h) => ({ name: h.time, count: h.count }))} />
          ) : (
            <ChartContainer key={`series-${rangeHours}`} config={trafficHourlyConfig} className="h-[240px] sm:h-[260px] w-full">
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
        </NavCard>

        <NavCard to="/logs?kind=traffic" className="p-4 sm:p-6 bg-card/80 border-border" ariaLabel="Top path">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Top path</h3>
          {!dataReady ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : topPathsData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có path.</p>
          ) : isMobile ? (
            <MiniCountList rows={topPathsData.map((p) => ({ name: p.fullPath, count: p.count }))} />
          ) : (
            <ChartContainer key={`paths-${rangeHours}`} config={countBarConfig} className="h-[240px] sm:h-[260px] w-full">
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
        </NavCard>

        <NavCard to="/logs?kind=traffic" className="p-4 sm:p-6 bg-card/80 border-border" ariaLabel="Method HTTP">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Method HTTP</h3>
          {!dataReady ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : methodData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p>
          ) : isMobile ? (
            <MiniCountList rows={methodData.map((m) => ({ name: m.label, count: m.count }))} />
          ) : (
            <ChartContainer key={`methods-${rangeHours}`} config={countBarConfig} className="h-[240px] sm:h-[260px] w-full">
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
        </NavCard>

        {showIntegrations ? (
          <OverviewCrmIntegrationsCard
            integrations={integrationRows}
            snapshotEntities={stats?.snapshot_entities ?? []}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
        <div className={!showIntegrations && dlqCounts.total > 0 ? 'xl:col-span-2' : 'xl:col-span-full'}>
          <NavCard to="/routes" className="rounded-2xl overflow-hidden bg-card/80 border-border" ariaLabel="Danh sách routes">
            <div className="p-6 border-b border-border flex justify-between items-center">
              <h3 className="font-bold text-white text-sm uppercase tracking-wider">Routes</h3>
              <span className="text-xs text-primary font-mono-tech">Quản lý →</span>
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
          </NavCard>
        </div>

        {!showIntegrations && dlqCounts.total > 0 ? (
          <NavCard to="/proxy-queue" className="rounded-2xl p-6 bg-card/80 border-border" ariaLabel="DLQ hàng đợi">
            <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">DLQ</h3>
            <p className="text-sm text-amber-300">
              {dlqCounts.pending} pending · {dlqCounts.replayed} replayed →
            </p>
          </NavCard>
        ) : null}
      </div>
    </>
  );
}

export function Overview() {
  const { user, loading } = useAdminAuth();

  if (loading) {
    return <p className="text-sm text-muted-foreground p-4 sm:p-6">Đang tải…</p>;
  }

  if (!user) return <OverviewGuest />;

  return (
    <ErrorBoundary title="Dashboard lỗi — thử tải lại hoặc dùng menu bên trái">
      <OverviewAdmin />
    </ErrorBoundary>
  );
}
