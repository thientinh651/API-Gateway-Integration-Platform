export type GatewayRouteRow = {
  id: number;
  path: string;
  target: string;
  timeout_secs: number;
  rate_limit_per_min: number;
  allowed_methods?: string;
  transform_add_headers?: string;
  transform_remove_headers?: string;
  retry_max?: number;
  retry_on_status?: string;
  retry_on_timeout?: number;
  queue_on_failure?: number;
};

import { DEFAULT_ALLOWED_METHODS } from './allowedMethodsOptions';

export function rowsToUiRoutes(rows: GatewayRouteRow[]) {
  return rows.map((r) => ({
    id: String(r.id),
    path: r.path,
    upstream: r.target,
    timeout: r.timeout_secs,
    rateLimit: r.rate_limit_per_min,
    allowedMethods: r.allowed_methods?.trim() || DEFAULT_ALLOWED_METHODS,
    transformAddHeaders: r.transform_add_headers ?? '{}',
    transformRemoveHeaders: r.transform_remove_headers ?? '[]',
    retryMax: r.retry_max ?? 0,
    retryOnStatus: r.retry_on_status ?? '502,503,504',
    retryOnTimeout: (r.retry_on_timeout ?? 1) !== 0,
    queueOnFailure: (r.queue_on_failure ?? 0) !== 0,
  }));
}
