export type GatewayRouteRow = {
  id: number;
  path: string;
  target: string;
  timeout_secs: number;
  rate_limit_per_min: number;
  /** PostgreSQL `TEXT[]` — `["*"]` hoặc `["GET","POST"]` */
  allowed_methods?: string[] | string;
  transform_add_headers?: string;
  transform_remove_headers?: string;
  retry_max?: number;
  /** PostgreSQL `INTEGER[]` — vd `[502,503,504]` */
  retry_on_status?: number[] | string;
  retry_on_timeout?: boolean;
  queue_on_failure?: boolean;
};

import { DEFAULT_ALLOWED_METHODS, allowedMethodsFromApi } from './allowedMethodsOptions';
import { DEFAULT_RETRY_ON_STATUS, retryOnStatusFromApi } from './retryOnStatusOptions';

export function rowsToUiRoutes(rows: GatewayRouteRow[]) {
  return rows.map((r) => ({
    id: String(r.id),
    path: r.path,
    upstream: r.target,
    timeout: r.timeout_secs,
    rateLimit: r.rate_limit_per_min,
    allowedMethods: allowedMethodsFromApi(r.allowed_methods),
    transformAddHeaders: r.transform_add_headers ?? '{}',
    transformRemoveHeaders: r.transform_remove_headers ?? '[]',
    retryMax: r.retry_max ?? 0,
    retryOnStatus: retryOnStatusFromApi(r.retry_on_status),
    retryOnTimeout: r.retry_on_timeout ?? true,
    queueOnFailure: r.queue_on_failure ?? false,
  }));
}

export { DEFAULT_ALLOWED_METHODS, DEFAULT_RETRY_ON_STATUS };
