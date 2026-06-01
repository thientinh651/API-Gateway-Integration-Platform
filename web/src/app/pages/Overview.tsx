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
  Database,
  Key,
  Plug,
  RefreshCw,
  Route,
  ShieldCheck,
} from 'lucide-react';
import {
  ApiClientError,
  fetchDashboardStats,
  fetchGatewayRoutes,
  type DashboardStats,
} from '../../lib/api';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import type { GatewayRouteRow } from '../../lib/gatewayRoutes';
import { formatDbTimestamp } from '../../lib/formatDbTimestamp';
import { OverviewGuest } from './OverviewGuest';

const CHART_COLORS = ['#3b82f6', '#f97316', '#a855f7', '#10b981', '#fb923c'];

const AXIS_TICK = '#94a3b8';
const GRID_STROKE = '#334155';

const entityBarConfig = {
  opportunity: { label: 'Opportunities', color: CHART_COLORS[0] },
  account: { label: 'Accounts', color: CHART_COLORS[1] },
  project: { label: 'Projects', color: CHART_COLORS[2] },
  task: { label: 'Tasks', color: CHART_COLORS[3] },
} satisfies ChartConfig;

const stagePieConfig = {
  count: { label: 'Số lượng', color: CHART_COLORS[0] },
} satisfies ChartConfig;

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [dash, routeRows] = await Promise.all([fetchDashboardStats(), fetchGatewayRoutes()]);
      setStats(dash);
      setRoutes(routeRows);
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

  const entityBarData = useMemo(
    () =>
      (stats?.snapshot_entities ?? []).map((e) => ({
        name: e.entity_type,
        label: e.label.replace('Salesforce ', 'SF ').replace('Zoho ', ''),
        count: e.record_count,
      })),
    [stats]
  );

  const stagePieData = useMemo(() => {
    const stages = stats?.salesforce_stages ?? [];
    if (stages.length > 0) {
      return stages.map((s) => ({ name: s.label, count: s.count }));
    }
    return (stats?.snapshot_entities ?? []).map((e) => ({
      name: e.label,
      count: e.record_count,
    }));
  }, [stats]);

  const timelineData = useMemo(() => {
    const map = new Map<string, { time: string; opportunity: number; account: number; project: number; task: number }>();
    for (const p of stats?.snapshot_timeline ?? []) {
      const time = formatDbTimestamp(p.fetched_at);
      const row = map.get(time) ?? { time, opportunity: 0, account: 0, project: 0, task: 0 };
      if (p.entity_type === 'opportunity') row.opportunity = p.record_count;
      if (p.entity_type === 'account') row.account = p.record_count;
      if (p.entity_type === 'project') row.project = p.record_count;
      if (p.entity_type === 'task') row.task = p.record_count;
      map.set(time, row);
    }
    return [...map.values()].slice(-12);
  }, [stats]);

  const lineConfig = {
    opportunity: { label: 'Opportunities', color: CHART_COLORS[0] },
    account: { label: 'Accounts', color: CHART_COLORS[1] },
    project: { label: 'Projects', color: CHART_COLORS[2] },
    task: { label: 'Tasks', color: CHART_COLORS[3] },
  } satisfies ChartConfig;

  const sf = stats?.integrations.find((i) => i.provider === 'salesforce');
  const zoho = stats?.integrations.find((i) => i.provider === 'zoho_projects');
  const audit = stats?.audit_24h;

  return (
    <>
      <div className="mb-8 flex flex-wrap justify-between gap-4 items-center">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Tổng quan</h1>
          <p className="text-muted-foreground">
            Gateway + tích hợp Salesforce / Zoho — dữ liệu thật từ snapshot & audit.
          </p>
        </div>
        <Button variant="outline" className="border-border" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </Button>
      </div>

      {loadError ? (
        <Card className="mb-6 p-4 border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">{loadError}</Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          icon={<Database className="text-primary" />}
          iconBg="bg-primary/10"
          title="Bản ghi snapshot"
          value={loading ? '…' : String(stats?.total_snapshot_records ?? 0)}
          badge={{ text: 'CRM + PM', variant: 'info' }}
        />
        <StatsCard
          icon={<Plug className="text-blue-500" />}
          iconBg="bg-blue-500/10"
          title="Salesforce"
          value={loading ? '…' : sf?.status ?? '—'}
          badge={{
            text: sf?.status === 'connected' ? 'OAuth OK' : 'Chưa connect',
            variant: sf?.status === 'connected' ? 'success' : 'warning',
          }}
        />
        <StatsCard
          icon={<Plug className="text-orange-500" />}
          iconBg="bg-orange-500/10"
          title="Zoho Projects"
          value={loading ? '…' : zoho?.status ?? '—'}
          badge={{
            text: zoho?.status === 'connected' ? 'OAuth OK' : 'Chưa connect',
            variant: zoho?.status === 'connected' ? 'success' : 'warning',
          }}
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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
          icon={<Activity className="text-cyan-500" />}
          iconBg="bg-cyan-500/10"
          title="Lần sync gần nhất"
          value={
            loading
              ? '…'
              : stats?.snapshot_entities[0]?.fetched_at?.slice(0, 16).replace('T', ' ') ?? 'Chưa sync'
          }
          badge={{ text: 'Integrations', variant: 'info' }}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-8">
        <Card className="p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">
            Snapshot theo entity (lần sync mới nhất)
          </h3>
          {entityBarData.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa có dữ liệu. Vào{' '}
              <Link to="/integrations" className="text-primary underline">
                Tích hợp
              </Link>{' '}
              → <strong>Đồng bộ snapshot</strong>.
            </p>
          ) : (
            <ChartContainer config={entityBarConfig} className="h-[280px] w-full aspect-auto">
              <BarChart data={entityBarData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
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
                  {entityBarData.map((entry, i) => (
                    <Cell
                      key={entry.name}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </Card>

        <Card className="p-6 bg-card/80 border-border">
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">
            {stats?.salesforce_stages?.length
              ? 'Salesforce — Opportunity theo Stage'
              : 'Phân bổ bản ghi snapshot'}
          </h3>
          {stagePieData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu biểu đồ.</p>
          ) : (
            <ChartContainer config={stagePieConfig} className="h-[280px] w-full aspect-auto">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                <Pie
                  data={stagePieData}
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
                  {stagePieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
        </Card>
      </div>

      <Card className="p-6 bg-card/80 border-border mb-8">
        <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">
          Lịch sử đồng bộ (số bản ghi theo thời điểm)
        </h3>
        {timelineData.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có lịch sử sync — mỗi lần bấm Đồng bộ sẽ thêm điểm trên biểu đồ.</p>
        ) : (
          <ChartContainer config={lineConfig} className="h-[300px] w-full aspect-auto">
            <LineChart data={timelineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={false}
                fontSize={10}
                interval="preserveStartEnd"
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
                dataKey="opportunity"
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                dot={{ r: 3, fill: CHART_COLORS[0] }}
              />
              <Line
                type="monotone"
                dataKey="account"
                stroke={CHART_COLORS[1]}
                strokeWidth={2}
                dot={{ r: 3, fill: CHART_COLORS[1] }}
              />
              <Line
                type="monotone"
                dataKey="project"
                stroke={CHART_COLORS[2]}
                strokeWidth={2}
                dot={{ r: 3, fill: CHART_COLORS[2] }}
              />
              <Line
                type="monotone"
                dataKey="task"
                stroke={CHART_COLORS[3]}
                strokeWidth={2}
                dot={{ r: 3, fill: CHART_COLORS[3] }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </Card>

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
          <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Connectors</h3>
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
                  <p className="text-xs text-muted-foreground">Chưa sync snapshot</p>
                )}
              </div>
            ))}
            <Link to="/integrations">
              <Button variant="outline" className="w-full border-border" size="sm">
                Quản lý tích hợp
              </Button>
            </Link>
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
