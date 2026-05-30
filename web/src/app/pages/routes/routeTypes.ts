export interface UiRoute {
  id: string;
  path: string;
  upstream: string;
  timeout: number;
  rateLimit: number;
  transformAddHeaders: string;
  transformRemoveHeaders: string;
  retryMax: number;
  retryOnStatus: string;
  retryOnTimeout: boolean;
  queueOnFailure: boolean;
}
