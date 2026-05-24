export interface UiRoute {
  id: string;
  path: string;
  upstream: string;
  timeout: number;
  rateLimit: number;
}
