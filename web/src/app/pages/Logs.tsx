import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ShieldCheck, Activity, Workflow } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { canViewAudit, canViewLogs, isAdmin } from '../../lib/rbac';
import { AdminAuditPanel } from './logs/AdminAuditPanel';
import { TrafficLogPanel } from './logs/TrafficLogPanel';
import { IntegrationLogPanel } from './logs/IntegrationLogPanel';

type LogTab = 'admin' | 'traffic' | 'integration';

export function Logs() {
  const { user } = useAdminAuth();
  const showAdmin = canViewAudit(user);
  const showTraffic = canViewLogs(user);
  const showIntegration = isAdmin(user);
  const [params, setParams] = useSearchParams();

  const clientKeyFilter = useMemo<number | null>(() => {
    const raw = params.get('client_key_id');
    if (!raw || !/^\d+$/.test(raw)) return null;
    return Number(raw);
  }, [params]);

  const defaultTab = useMemo<LogTab>(() => {
    const t = params.get('tab');
    if (t === 'admin' && showAdmin) return 'admin';
    if (t === 'traffic' && showTraffic) return 'traffic';
    if (t === 'integration' && showIntegration) return 'integration';
    // legacy params imply traffic view
    if (
      (clientKeyFilter != null ||
        params.get('reason') ||
        params.get('result') ||
        params.get('search') ||
        params.get('q')) &&
      showTraffic
    ) {
      return 'traffic';
    }
    if (showTraffic) return 'traffic';
    if (showAdmin) return 'admin';
    return 'integration';
  }, [params, showAdmin, showTraffic, showIntegration, clientKeyFilter]);

  const [activeTab, setActiveTab] = useState<LogTab>(defaultTab);

  const setTab = useCallback(
    (tab: LogTab) => {
      setActiveTab(tab);
      const next = new URLSearchParams(params);
      next.set('tab', tab);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const clearClientKey = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('client_key_id');
    setParams(next, { replace: true });
  }, [params, setParams]);

  return (
    <>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Log vận hành</h1>
        <p className="text-sm text-muted-foreground">
          Quản trị · Route/Traffic · Tích hợp.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as LogTab)} className="gap-6">
        <TabsList className="bg-slate-950/80 border border-border flex-wrap h-auto p-1">
          {showAdmin ? (
            <TabsTrigger value="admin" className="data-[state=active]:text-primary gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Quản trị
            </TabsTrigger>
          ) : null}
          {showTraffic ? (
            <TabsTrigger value="traffic" className="data-[state=active]:text-primary gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              Route / Traffic
            </TabsTrigger>
          ) : null}
          {showIntegration ? (
            <TabsTrigger value="integration" className="data-[state=active]:text-primary gap-1.5">
              <Workflow className="w-3.5 h-3.5" />
              Tích hợp
            </TabsTrigger>
          ) : null}
        </TabsList>

        {showAdmin ? (
          <TabsContent value="admin" className="mt-0">
            <AdminAuditPanel />
          </TabsContent>
        ) : null}

        {showTraffic ? (
          <TabsContent value="traffic" className="mt-0">
            <TrafficLogPanel clientKeyFilter={clientKeyFilter} onClearClientKey={clearClientKey} />
          </TabsContent>
        ) : null}

        {showIntegration ? (
          <TabsContent value="integration" className="mt-0">
            <IntegrationLogPanel />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
