export type GatewayRouteRow = {
  id: number;
  path: string;
  target: string;
  timeout_secs: number;
  rate_limit_per_min: number;
};

export function rowsToUiRoutes(rows: GatewayRouteRow[]) {
  return rows.map((r) => ({
    id: String(r.id),
    path: r.path,
    upstream: r.target,
    timeout: r.timeout_secs,
    rateLimit: r.rate_limit_per_min,
  }));
}
