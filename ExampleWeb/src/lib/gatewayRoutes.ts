export type GatewayRouteRow = { id: number; path: string; target: string };

export function rowsToUiRoutes(rows: GatewayRouteRow[]) {
  return rows.map((r) => ({
    id: String(r.id),
    method: '*',
    path: r.path,
    upstream: r.target,
    timeout: 30,
    rateLimit: 100,
  }));
}
