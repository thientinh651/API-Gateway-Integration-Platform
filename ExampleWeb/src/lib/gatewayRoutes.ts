export type GatewayRouteRow = { path: string; target: string };

export function rowsToUiRoutes(
  rows: GatewayRouteRow[],
  makeId: (i: number) => string = (i) => `gw-${i}`
) {
  return rows.map((r, i) => ({
    id: makeId(i),
    method: '*',
    path: r.path,
    upstream: r.target,
    timeout: 30,
    rateLimit: 100,
  }));
}
