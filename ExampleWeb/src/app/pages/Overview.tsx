import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { StatsCard } from '../components/dashboard/StatsCard';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Zap, Route, Key, Clock } from 'lucide-react';
import { fetchGatewayRoutes } from '../../lib/api';
import type { GatewayRouteRow } from '../../lib/gatewayRoutes';

export function Overview() {
  const [routes, setRoutes] = useState<GatewayRouteRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uptime, setUptime] = useState('00:00:00');

  const loadRoutes = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await fetchGatewayRoutes();
      setRoutes(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      toast.error('Không tải được /api/routes');
    }
  }, []);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      const seconds = elapsed % 60;
      setUptime(
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
          .toString()
          .padStart(2, '0')}`
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Xin chào!</h1>
        <p className="text-muted-foreground">
          Chào mừng bạn trở lại với hệ thống điều phối Avaso Gateway.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          icon={<Zap className="text-blue-500" />}
          iconBg="bg-blue-500/10"
          title="Gateway"
          value="Healthy"
          badge={{ text: 'Online', variant: 'success' }}
        />
        <StatsCard
          icon={<Route className="text-primary" />}
          iconBg="bg-primary/10"
          title="Routes"
          value={routes.length.toString()}
          badge={{ text: 'Config', variant: 'info' }}
        />
        <StatsCard
          icon={<Key className="text-purple-500" />}
          iconBg="bg-purple-500/10"
          title="x-api-key"
          value={loadError ? 'Lỗi' : 'OK'}
          badge={{ text: loadError ? 'Check .env' : 'Admin API', variant: loadError ? 'warning' : 'info' }}
        />
        <StatsCard
          icon={<Clock className="text-emerald-500" />}
          iconBg="bg-emerald-500/10"
          title="Uptime"
          value={uptime}
          badge={{ text: 'Online', variant: 'success' }}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2">
          <Card className="rounded-2xl overflow-hidden bg-card/80 backdrop-blur-sm border-border">
            <div className="p-6 border-b border-border flex justify-between items-center">
              <h3 className="font-bold text-white text-sm uppercase tracking-wider">
                Danh sách Route (config.yaml)
              </h3>
              <Button onClick={() => void loadRoutes()} className="bg-primary hover:bg-primary/90">
                Reload
              </Button>
            </div>
            {loadError ? (
              <div className="px-6 py-4 text-sm text-amber-400 border-b border-border/50">{loadError}</div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
                  <tr>
                    <th className="px-6 py-4">Path</th>
                    <th className="px-6 py-4">Target</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {routes.length > 0 ? (
                    routes.map((route, index) => (
                      <tr key={`${route.path}-${index}`} className="border-b border-border/50">
                        <td className="px-6 py-4 text-slate-300">{route.path}</td>
                        <td className="px-6 py-4 text-slate-400">{route.target}</td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-b border-border/50">
                      <td className="px-6 py-4 text-slate-400" colSpan={2}>
                        {loadError ? '—' : 'Đang tải hoặc chưa có route…'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div>
          <Card className="rounded-2xl p-6 bg-card/80 backdrop-blur-sm border-border">
            <h3 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Quick Stats</h3>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Total Requests (24h)</p>
                <p className="text-xl font-bold text-white">12,547</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Avg Response Time</p>
                <p className="text-xl font-bold text-white">45ms</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Error Rate</p>
                <p className="text-xl font-bold text-emerald-500">0.12%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Active API Keys</p>
                <p className="text-xl font-bold text-white">8</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
