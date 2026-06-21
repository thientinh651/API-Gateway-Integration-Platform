export interface ClientRegistryRow {
  id: string;
  name: string;
  apiKey: string;
  authMode: string;
  integrationType: string;
  isActive: boolean;
  rateLimitPerMinute: number;
  allowedRouteIds: number[];
  lastUsedAt: string | null;
}

export function authModeLabel(mode: string): string {
  if (mode === 'oauth_client') return 'OAuth2 client';
  if (mode === 'hmac') return 'OAuth2 client';
  if (mode === 'legacy') return 'Legacy (deprecated)';
  return mode;
}

/** Nhãn ngắn cho bảng — tránh tràn cột. */
export function authModeLabelShort(mode: string): string {
  if (mode === 'oauth_client' || mode === 'hmac') return 'OAuth2';
  if (mode === 'legacy') return 'Legacy';
  return mode;
}

export function authorizationLabel(allowedRouteIds: number[]): string {
  if (allowedRouteIds.length === 0) return 'Tất cả route trong tenant';
  return `${allowedRouteIds.length} route được phép`;
}

/** Nhãn ngắn cho bảng — tránh tràn cột. */
export function authorizationLabelShort(allowedRouteIds: number[]): string {
  if (allowedRouteIds.length === 0) return 'Mọi route';
  return `${allowedRouteIds.length} route ACL`;
}
