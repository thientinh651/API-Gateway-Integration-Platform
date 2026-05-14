import { useCallback, useEffect, useState } from 'react';
import { fetchGatewayRoutes } from '../lib/api';
import { rowsToUiRoutes } from '../lib/gatewayRoutes';
import type { UiRoute } from '../app/pages/routes/routeTypes';

export function useGatewayRoutes() {
  const [routes, setRoutes] = useState<UiRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchGatewayRoutes();
      setRoutes(rowsToUiRoutes(rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { routes, setRoutes, loading, error, reload };
}
