import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  CartesianGrid,
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
import { cn } from '../components/ui/utils';
import {
  Activity,
  Key,
  ListOrdered,
  RefreshCw,
  Route,
  ShieldX,
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
import {
  DASHBOARD_PRESETS,
  DEFAULT_PRESET_ID,
  buildLatencySeries,
  buildTrafficSeries,
  findPreset,
  hasLatencySamples,
  presetWindow,
  sumRequests,
  tickInterval,
  type BucketUnit,
  type DashboardPresetId,
} from '../../lib/dashboardSeries';
import { reasonLabel } from '../../lib/middlewareLabels';
import { OverviewGuest } from './OverviewGuest';
import { TechPageHeader } from '../components/tech/TechPageHeader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { isSyncWorkerClient } from '../../lib/oauthClientId';

const CHART_COLORS = ['#10b981', '#3b82f6', '#f97316', '#ef4444', '#a855f7', '#fb923c'];
const STATUS_BAR_COLORS: Record<string, string> = {
  '2xx': '#10b981',
  '3xx': '#3b82f6',
  '4xx': '#f97316',
  '5xx': '#ef4444',
  other: '#94a3b8',
};

const AXIS_TICK = '#94a3b8';
const GRID_STROKE = '#334155';

const BUCKET_NOTE: Record<BucketUnit, string> = {
  minute: 'mỗi cột 1 phút',
  hour: 'mỗi cột 1 giờ',
  day: 'mỗi cột 1 ngày',
};

function bucketTooltipLabel(
  _value: unknown,
  payload?: Array<{ payload?: { fullLabel?: string } }>,
): string {
  return payload?.[0]?.payload?.fullLabel ?? '';
}

const trafficSeriesConfig = {
  ok: { label: 'Thành công', color: CHART_COLORS[1] },
  errors: { label: 'Lỗi', color: CHART_COLORS[3] },
} satisfies ChartConfig;

const latencySeriesConfig = {
  p50: { label: 'P50', color: CHART_COLORS[0] },
  p95: { label: 'P95', color: CHART_COLORS[2] },
  p99: { label: 'P99', color: CHART_COLORS[3] },
} satisfies ChartConfig;

const STATUS_ORDER = ['2xx', '3xx', '4xx', '5xx', 'other'] as const;

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

function pct(n: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((n / total) * 1000) / 10;
}

function fmtNum(n: number): string {
  return n.toLocaleString('vi-VN');
}

function truncatePath(path: string, max = 32) {
  if (path.length <= max) return path;
  return `${path.slice(0, max - 1)}…`;
}

type HealthState = {
  gateway: 'up' | 'down' | 'unknown';
  database: 'up' | 'down' | 'unknown';
  redis: 'up' | 'down' | 'unknown';
};

function useSystemHealth(): HealthState {
  const [state, setState] = useState<HealthState>({
    gateway: 'unknown',
    database: 'unknown',
    redis: 'unknown',
  });

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch('/health', { credentials: 'same-origin' });
        const j = (await r.json()) as {
          status?: string;
          components?: {
            database?: { status?: string };
            session_store?: { status?: string };
          };
        };
        if (cancelled) return;
        setState({
          gateway: r.ok || j.status === 'degraded' ? 'up' : 'down',
          database: j.components?.database?.status === 'up' ? 'up' : 'down',
          redis: j.components?.session_store?.status === 'up' ? 'up' : 'down',
        });
      } catch {
        if (!cancelled) {
          setState({ gateway: 'down', database: 'unknown', redis: 'unknown' });
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return state;
}

function HealthDot({ label, status }: { label: string; status: HealthState[keyof HealthState] }) {
  const color =
    status === 'up' ? 'bg-emerald-400' : status === 'down' ? 'bg-red-500' : 'bg-slate-500';
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
      <span className={cn('h-1.5 w-1.5 rounded-full', color)} aria-hidden />
      {label}
    </span>
  );
}

function PanelShell({
  title,
  action,
  subtitle,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('h-full flex flex-col', className)}>
      <div className="flex items-start justify-between gap-2 mb-3 shrink-0 px-4 sm:px-5 pt-4 sm:pt-5">
        <div className="min-w-0">
          <h3 className="font-semibold text-white text-xs uppercase tracking-wider">{title}</h3>
          {subtitle ? <div className="mt-1 text-[11px] text-muted-foreground">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      <div className="flex-1 min-h-0 px-4 sm:px-5 pb-4 sm:pb-5">{children}</div>
    </div>
  );
}

function RankedBarList({
  rows,
  valueClassName = 'text-cyan-400',
}: {
  rows: Array<{ key: string; label: ReactNode; count: number; meta?: ReactNode }>;
  valueClassName?: string;
}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-slate-300">{r.label}</span>
            <span className={cn('font-mono shrink-0 tabular-nums text-right', valueClassName)}>
              {fmtNum(r.count)}
              {r.meta ? <span className="text-muted-foreground font-sans"> {r.meta}</span> : null}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/75"
              style={{ width: `${Math.max(4, Math.round((r.count / max) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function OverviewCrmIntegrationsCard({
  integrations,
  snapshotEntities,
}: {
  integrations: DashboardStats['integrations'];
  snapshotEntities: DashboardStats['snapshot_entities'];
}) {
  return (
    <NavCard to="/integrations" className="p-0 bg-card/80 border-border overflow-hidden" ariaLabel="Tích hợp CRM">
      <PanelShell title="Tích hợp" action={<span className="text-[11px] text-primary font-medium">Mở →</span>}>
        {integrations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa kết nối provider.</p>
        ) : (
          <div className="space-y-3">
            {integrations.map((row) => {
              const snapshots = snapshotEntities.filter((s) => s.provider === row.provider);
              return (
                <div
                  key={row.provider}
                  className="rounded-lg border border-border/80 bg-slate-950/40 p-3 min-h-[7.25rem] flex flex-col"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-medium text-white text-sm truncate">{row.label}</span>
                    <Badge className={`${integrationStatusBadge(row.status)} border text-[10px] shrink-0`}>
                      {INTEGRATION_STATUS_VI[row.status] ?? row.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Lần đồng bộ cuối:{' '}
                    {row.last_sync_at ? formatDbTimestamp(row.last_sync_at) : 'Chưa đồng bộ'}
                  </p>
                  {row.last_error && row.status === 'error' ? (
                    <p className="text-[11px] text-red-300/90 mt-1 line-clamp-2" title={row.last_error}>
                      ⚠ {row.last_error}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5 mt-auto pt-3 min-h-[1.75rem]">
                    {snapshots.length > 0 ? (
                      snapshots.slice(0, 4).map((s) => (
                        <Badge
                          key={`${s.provider}-${s.entity_type}`}
                          variant="outline"
                          className="text-[10px] border-border/80 text-slate-400"
                        >
                          {s.label}: {s.record_count}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Chưa có snapshot</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PanelShell>
    </NavCard>
  );
}

function OverviewAdmin() {
  const { user } = useAdminAuth();
  const isMobile = useMediaQuery('(max-width: 639px)');
  const showIntegrations = canManageIntegrations(user);
  const health = useSystemHealth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [routes, setRoutes] = useState<GatewayRouteRow[]>([]);
  const [proxyQueueItems, setProxyQueueItems] = useState<ProxyQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [presetId, setPresetId] = useState<DashboardPresetId>(DEFAULT_PRESET_ID);
  /** Cửa sổ chỉ đổi khi chọn preset hoặc bấm Làm mới — tránh bucket nhảy giữa các lần render. */
  const [window_, setWindow] = useState(() => presetWindow(findPreset(DEFAULT_PRESET_ID)));
  const preset = findPreset(presetId);
  const win = preset.label;
  const dataReady = !loading && stats != null;

  const selectPreset = useCallback((id: string) => {
    const next = findPreset(id);
    setPresetId(next.id);
    setWindow(presetWindow(next));
  }, []);

  /** Dựng lại cửa sổ tới thời điểm hiện tại — đổi state nên `load` chạy lại. */
  const refresh = useCallback(() => {
    setWindow(presetWindow(findPreset(presetId)));
  }, [presetId]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [dash, routeRows, queue] = await Promise.all([
        fetchDashboardStats({ from: window_.from, to: window_.to }),
        fetchGatewayRoutes(),
        fetchProxyQueue().catch(() => []),
      ]);
      setStats(dash);
      setRoutes(routeRows);
      setProxyQueueItems(queue);
      setUpdatedAt(new Date());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      const status = e instanceof ApiClientError ? e.status : 0;
      if (status !== 401) toast.error('Không tải được dashboard');
    } finally {
      setLoading(false);
    }
  }, [user, window_]);

  useEffect(() => {
    void load();
  }, [load]);

  const traffic = stats?.traffic_24h;
  const errorCount = (traffic?.denied ?? 0) + (traffic?.upstream_error ?? 0);
  const successRate = traffic ? pct(traffic.success, traffic.total) : null;
  const errorRate = traffic ? pct(errorCount, traffic.total) : null;
  const dlqCounts = useMemo(() => countDlqByStatus(proxyQueueItems), [proxyQueueItems]);

  const integrationRows = useMemo(
    () => (stats?.integrations ?? []).filter((r) => ACTIVE_INTEGRATION_PROVIDERS.has(r.provider)),
    [stats?.integrations],
  );

  const statusBars = useMemo(() => {
    const map = new Map((stats?.traffic_status_buckets ?? []).map((b) => [b.label, b.count]));
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    return STATUS_ORDER.filter((k) => (map.get(k) ?? 0) > 0 || k === '2xx' || k === '4xx' || k === '5xx').map(
      (label) => ({
        label,
        count: map.get(label) ?? 0,
        pct: total > 0 ? Math.round(((map.get(label) ?? 0) / total) * 100) : 0,
      }),
    );
  }, [stats]);

  /** Ưu tiên cửa sổ backend đã dùng để chart mô tả đúng dữ liệu vừa nhận. */
  const seriesWindow = useMemo(
    () => ({
      from: stats?.window_from ?? window_.from,
      to: stats?.window_to ?? window_.to,
      unit: window_.unit,
    }),
    [stats?.window_from, stats?.window_to, window_],
  );

  const trafficSeriesData = useMemo(
    () =>
      buildTrafficSeries(
        (stats?.traffic_hourly ?? []).map((h) => ({
          time: h.label,
          requests: h.count,
          errors: h.errors ?? 0,
        })),
        seriesWindow,
      ),
    [stats?.traffic_hourly, seriesWindow],
  );

  const latencySeriesData = useMemo(
    () =>
      buildLatencySeries(
        (stats?.traffic_latency_hourly ?? []).map((h) => ({
          time: h.label,
          p50: h.p50_ms,
          p95: h.p95_ms,
          p99: h.p99_ms,
        })),
        seriesWindow,
      ),
    [stats?.traffic_latency_hourly, seriesWindow],
  );

  const denialRows = useMemo(() => {
    const rows = stats?.traffic_denial_reasons ?? [];
    return rows.map((r) => ({
      key: r.label,
      count: r.count,
      label: (
        <Link
          to={`/logs?kind=traffic&reason=${encodeURIComponent(r.label)}`}
          className="truncate hover:text-primary hover:underline"
        >
          {reasonLabel(r.label)}
        </Link>
      ),
      meta: <span className="text-slate-500">→</span>,
    }));
  }, [stats]);

  const denialTotal = useMemo(
    () => (stats?.traffic_denial_reasons ?? []).reduce((s, r) => s + r.count, 0),
    [stats],
  );

  const clientRows = useMemo(() => {
    const list = stats?.client_traffic_top ?? [];
    const total = traffic?.total ?? 0;
    const mapped = list.map((c) => {
      const share = pct(c.total, total);
      const errPct = pct(c.errors ?? 0, c.total);
      return { ...c, share, errPct };
    });
    const primary = mapped.filter((c, i) => (c.share ?? 0) >= 1 || i < 5);
    const rest = mapped.filter((c) => !primary.includes(c));
    const rows = primary.map((c) => ({
      key: String(c.client_key_id),
      count: c.total,
      label: (
        <span className="flex min-w-0 items-center gap-1.5">
          <Link
            to={`/logs?kind=traffic&client_key_id=${c.client_key_id}`}
            className="truncate hover:text-primary hover:underline"
            title={c.name}
          >
            {c.name}
          </Link>
          {isSyncWorkerClient(c.name) ? (
            <Badge className="shrink-0 border border-violet-500/30 bg-violet-500/10 px-1.5 py-0 text-[10px] text-violet-300">
              Sync Worker
            </Badge>
          ) : null}
        </span>
      ),
      meta: (
        <span>
          · {c.share ?? 0}% traffic
          {c.errPct != null ? (
            <span className={c.errPct >= 20 ? ' text-red-400' : ' text-slate-500'}>
              {' '}
              · {c.errPct}% lỗi
            </span>
          ) : null}
        </span>
      ),
    }));
    if (rest.length > 0) {
      const otherTotal = rest.reduce((s, c) => s + c.total, 0);
      const otherErr = rest.reduce((s, c) => s + (c.errors ?? 0), 0);
      rows.push({
        key: '__other__',
        count: otherTotal,
        label: <span className="text-slate-400">Khác ({rest.length})</span>,
        meta: (
          <span>
            · {pct(otherTotal, total) ?? 0}%
            {otherTotal > 0 ? ` · ${pct(otherErr, otherTotal) ?? 0}% lỗi` : ''}
          </span>
        ),
      });
    }
    return rows;
  }, [stats, traffic]);

  const pathRows = useMemo(() => {
    return (stats?.traffic_top_paths ?? []).map((p) => {
      const total = p.total ?? p.count ?? 0;
      const errors = p.errors ?? 0;
      const errPct = pct(errors, total);
      return {
        key: p.label,
        count: total,
        label: (
          <Link
            to={`/logs?kind=traffic&search=${encodeURIComponent(p.label)}`}
            className="truncate font-mono text-[11px] hover:text-primary hover:underline"
            title={p.label}
          >
            {truncatePath(p.label)}
          </Link>
        ),
        meta: (
          <span className={errPct != null && errPct >= 20 ? 'text-red-400' : 'text-slate-500'}>
            · {errPct ?? 0}% lỗi
          </span>
        ),
      };
    });
  }, [stats]);

  const topRoutePreview = useMemo(() => {
    return (stats?.traffic_top_paths ?? []).slice(0, 4).map((p) => p.label);
  }, [stats]);

  const errorTone: 'default' | 'danger' | 'warning' =
    errorRate == null ? 'default' : errorRate >= 20 ? 'danger' : errorRate >= 5 ? 'warning' : 'default';

  return (
    <>
      <TechPageHeader
        codeLine={`// dashboard · ${win}`}
        title="Tổng quan"
        actions={
          <div className="flex flex-col items-stretch sm:items-end gap-2">
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <Select value={presetId} onValueChange={selectPreset}>
                <SelectTrigger className="w-[170px] bg-input border-border font-mono-tech text-xs h-9">
                  <SelectValue>{win}</SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {DASHBOARD_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="font-mono-tech text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="border-border font-mono-tech text-xs"
                onClick={refresh}
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Làm mới
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 justify-end text-[11px] text-muted-foreground">
              <HealthDot label="Gateway" status={health.gateway} />
              <HealthDot label="PostgreSQL" status={health.database} />
              <HealthDot label="Redis" status={health.redis} />
              <span>
                Cập nhật:{' '}
                {updatedAt
                  ? updatedAt.toLocaleTimeString('vi-VN', { hour12: false })
                  : '—'}
              </span>
            </div>
          </div>
        }
      />

      {loadError ? (
        <Card className="mb-6 p-4 border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">{loadError}</Card>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-3 items-stretch">
        <StatsCard
          to="/logs?kind=traffic"
          icon={<Activity className="text-blue-500 w-4 h-4" />}
          iconBg="bg-blue-500/10"
          title="Requests"
          value={dataReady ? fmtNum(traffic?.total ?? 0) : '…'}
          hint={
            dataReady && successRate != null
              ? `${successRate.toLocaleString('vi-VN')}% thành công`
              : undefined
          }
        />
        <StatsCard
          to="/logs?kind=traffic&result=success"
          icon={<Route className="text-emerald-500 w-4 h-4" />}
          iconBg="bg-emerald-500/10"
          title="Thành công"
          value={dataReady ? fmtNum(traffic?.success ?? 0) : '…'}
          hint={
            dataReady && successRate != null
              ? `${successRate.toLocaleString('vi-VN')}%`
              : undefined
          }
          valueTone="success"
        />
        <StatsCard
          to="/logs?kind=traffic&result=failure"
          icon={<ShieldX className="text-red-500 w-4 h-4" />}
          iconBg="bg-red-500/10"
          title="Error rate"
          value={dataReady && errorRate != null ? `${errorRate.toLocaleString('vi-VN')}%` : dataReady ? '0%' : '…'}
          hint={
            dataReady
              ? `${fmtNum(errorCount)} / ${fmtNum(traffic?.total ?? 0)} requests`
              : undefined
          }
          valueTone={errorTone}
          badge={
            dataReady && errorRate != null && errorRate >= 20
              ? { text: 'Cần chú ý', variant: 'danger' }
              : undefined
          }
        />
        <StatsCard
          to="/proxy-queue"
          icon={<ListOrdered className="text-amber-500 w-4 h-4" />}
          iconBg="bg-amber-500/10"
          title="DLQ"
          value={dataReady ? String(dlqCounts.total || (traffic?.queued ?? 0)) : '…'}
          hint={
            dataReady
              ? `${dlqCounts.pending} Pending · ${dlqCounts.replayed} Replayed`
              : undefined
          }
          badge={
            dataReady && dlqCounts.pending > 0
              ? { text: 'Có pending', variant: 'warning' }
              : undefined
          }
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 lg:gap-5 mb-4 min-w-0 items-stretch">
        <Card className="p-0 bg-card/80 border-border overflow-hidden min-w-0">
          <PanelShell
            title="Request / Error theo thời gian"
            subtitle={
              dataReady
                ? `${fmtNum(sumRequests(trafficSeriesData))} requests · ${trafficSeriesData.length} cột · ${BUCKET_NOTE[seriesWindow.unit]}`
                : undefined
            }
          >
            {!dataReady ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : sumRequests(trafficSeriesData) === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có traffic trong khoảng này.</p>
            ) : isMobile ? (
              <ul className="space-y-2 text-xs">
                {trafficSeriesData.slice(-8).map((h) => (
                  <li key={h.key} className="flex justify-between gap-2 text-slate-300">
                    <span>{h.fullLabel}</span>
                    <span className="font-mono tabular-nums">
                      {h.requests}
                      <span className="text-red-400"> / {h.errors}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <ChartContainer
                key={`req-err-${presetId}`}
                config={trafficSeriesConfig}
                className="h-[240px] w-full"
              >
                <BarChart data={trafficSeriesData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={GRID_STROKE} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    fontSize={10}
                    tick={{ fill: AXIS_TICK }}
                    interval={tickInterval(trafficSeriesData.length)}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    allowDecimals={false}
                    tick={{ fill: AXIS_TICK }}
                    width={40}
                  />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={bucketTooltipLabel} />} />
                  <Bar dataKey="ok" stackId="req" fill={CHART_COLORS[1]} />
                  <Bar dataKey="errors" stackId="req" fill={CHART_COLORS[3]} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </PanelShell>
        </Card>

        <Card className="p-0 bg-card/80 border-border overflow-hidden min-w-0">
          <PanelShell
            title="Độ trễ theo thời gian"
          >
            {!dataReady ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : !hasLatencySamples(latencySeriesData) ? (
              <p className="text-sm text-muted-foreground">Chưa có dữ liệu latency.</p>
            ) : isMobile ? (
              <ul className="space-y-2 text-xs">
                {latencySeriesData
                  .filter((h) => h.p50 != null)
                  .slice(-6)
                  .map((h) => (
                    <li key={h.key} className="flex justify-between gap-2 text-slate-300">
                      <span>{h.fullLabel}</span>
                      <span className="font-mono tabular-nums text-[10px]">
                        {h.p50}/{h.p95}/{h.p99}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <ChartContainer
                key={`lat-${presetId}`}
                config={latencySeriesConfig}
                className="h-[240px] w-full"
              >
                <LineChart data={latencySeriesData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={GRID_STROKE} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    fontSize={10}
                    tick={{ fill: AXIS_TICK }}
                    interval={tickInterval(latencySeriesData.length)}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    tick={{ fill: AXIS_TICK }}
                    width={40}
                  />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={bucketTooltipLabel} />} />
                  <Line
                    type="monotone"
                    dataKey="p50"
                    stroke={CHART_COLORS[0]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="p95"
                    stroke={CHART_COLORS[2]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="p99"
                    stroke={CHART_COLORS[3]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </PanelShell>
        </Card>

        <Card className="p-0 bg-card/80 border-border overflow-hidden">
          <PanelShell title="HTTP Status">
            {!dataReady ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : statusBars.every((b) => b.count === 0) ? (
              <p className="text-sm text-muted-foreground">Chưa có kết nối.</p>
            ) : (
              <ul className="space-y-3">
                {statusBars.map((b) => (
                  <li key={b.label} className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-mono">{b.label}</span>
                      <span className="font-mono tabular-nums text-slate-400">
                        {fmtNum(b.count)}
                        <span className="text-muted-foreground"> · {b.pct}%</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-800/80 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(b.count > 0 ? 3 : 0, b.pct)}%`,
                          backgroundColor: STATUS_BAR_COLORS[b.label] ?? CHART_COLORS[5],
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PanelShell>
        </Card>

        <Card className="p-0 bg-card/80 border-border overflow-hidden">
          <PanelShell
            title="Từ chối"
            subtitle={dataReady ? `${fmtNum(denialTotal)} requests` : undefined}
            action={
              <Link to="/logs?kind=traffic&result=failure" className="text-[11px] text-primary font-medium">
                Logs →
              </Link>
            }
          >
            {!dataReady ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : denialRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Không có từ chối.</p>
            ) : (
              <RankedBarList rows={denialRows} valueClassName="text-amber-400" />
            )}
          </PanelShell>
        </Card>

        <Card className="p-0 bg-card/80 border-border overflow-hidden">
          <PanelShell
            title="Top client"
            action={
              <Link to="/auth" className="text-[11px] text-primary font-medium">
                Client →
              </Link>
            }
          >
            {!dataReady ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : clientRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có traffic.</p>
            ) : (
              <RankedBarList rows={clientRows} />
            )}
          </PanelShell>
        </Card>

        <Card className="p-0 bg-card/80 border-border overflow-hidden">
          <PanelShell
            title="Top route"
            action={
              <Link to="/logs?kind=traffic" className="text-[11px] text-primary font-medium">
                Logs →
              </Link>
            }
          >
            {!dataReady ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : pathRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có path.</p>
            ) : (
              <RankedBarList rows={pathRows} />
            )}
          </PanelShell>
        </Card>

        {showIntegrations ? (
          <OverviewCrmIntegrationsCard
            integrations={integrationRows}
            snapshotEntities={stats?.snapshot_entities ?? []}
          />
        ) : null}

        <Card className="p-0 bg-card/80 border-border overflow-hidden">
          <PanelShell
            title="DLQ / Hàng đợi"
            action={
              <Link to="/proxy-queue" className="text-[11px] text-primary font-medium">
                Mở →
              </Link>
            }
          >
            {!dataReady ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border/70 bg-slate-950/40 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending</p>
                  <p className="text-xl font-mono font-bold text-amber-400 mt-1">{dlqCounts.pending}</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-slate-950/40 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Failed</p>
                  <p className="text-xl font-mono font-bold text-red-400 mt-1">{dlqCounts.failedPermanent}</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-slate-950/40 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Replayed</p>
                  <p className="text-xl font-mono font-bold text-emerald-400 mt-1">{dlqCounts.replayed}</p>
                </div>
              </div>
            )}
          </PanelShell>
        </Card>
      </div>

      {/* Compact routes */}
      <Card className="p-0 bg-card/80 border-border overflow-hidden">
        <PanelShell
          title="Routes"
          subtitle={dataReady ? `${stats?.routes_count ?? routes.length} routes` : undefined}
          action={
            <Link to="/routes" className="text-[11px] text-primary font-medium">
              Quản lý →
            </Link>
          }
        >
          {!dataReady ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : topRoutePreview.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có traffic path — xem cấu hình Routes.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {topRoutePreview.map((path) => (
                <li key={path} className="flex items-center gap-2 text-slate-300">
                  <Key className="w-3 h-3 text-slate-500 shrink-0" />
                  <span className="font-mono truncate">{path}</span>
                </li>
              ))}
            </ul>
          )}
        </PanelShell>
      </Card>
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
