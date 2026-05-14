export interface UiRoute {
  id: string;
  method: string;
  path: string;
  upstream: string;
  timeout?: number;
  rateLimit?: number;
}
