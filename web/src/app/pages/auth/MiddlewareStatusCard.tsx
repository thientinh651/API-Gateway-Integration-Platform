import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Gauge, Route, Shield, Users } from 'lucide-react';
import { fetchMiddlewareStatus, type MiddlewareStatus } from '../../../lib/api';
import { Card } from '../../components/ui/card';
import type { ClientRegistryRow } from './clientRegistryTypes';

type Props = {
  clients: ClientRegistryRow[];
  /** Tăng sau reload (xóa client, đổi route, settings…) để fetch lại routes / global RL */
  refreshKey?: number;
};

export function MiddlewareStatusCard({ clients, refreshKey = 0 }: Props) {
  const [status, setStatus] = useState<MiddlewareStatus | null>(null);

  const clientStats = useMemo(() => {
    const active = clients.filter((c) => c.isActive).length;
    return {
      total: clients.length,
      active,
      disabled: clients.length - active,
    };
  }, [clients]);

  useEffect(() => {
    void fetchMiddlewareStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [refreshKey]);

  if (!status) return null;

  const rl = status.rate_limit_global_enabled
    ? `${status.rate_limit_global_per_min}/phút`
    : 'tắt';

  return (
      <Card className="mb-6 p-4 rounded-2xl bg-slate-950/40 border-border border-dashed scroll-mt-24" id="section-middleware-status">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
        Trạng thái
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="flex items-start gap-2">
          <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-slate-400">Client OAuth</p>
            <p className="text-white font-mono">{clientStats.total}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {clientStats.active} On · {clientStats.disabled} Off
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Route className="w-3.5 h-3.5 text-violet-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-slate-400">Routes</p>
            <p className="text-white font-mono">{status.routes_count}</p>
            <Link to="/routes" className="text-[10px] text-primary hover:underline">
              Quản lý
            </Link>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Gauge className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-slate-400">Ratelimit global</p>
            <p className="text-white font-mono">{rl}</p>
            <Link to="/settings" className="text-[10px] text-primary hover:underline">
              Cài đặt
            </Link>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Users className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-slate-400">Data plane</p>
            <p className="text-white font-mono text-[10px] truncate">{status.data_plane_prefix}/*</p>
            <Link to="/proxy-try" className="text-[10px] text-primary hover:underline">
              Thử gọi API
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}
