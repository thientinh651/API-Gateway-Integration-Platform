/** OAuth2 client_id prefix (identifier — not a crypto public key). */
export const OAUTH_CLIENT_ID_PREFIX = 'avaso_cid_';
/** Legacy Stripe-style prefix — still valid for existing clients. */
export const OAUTH_CLIENT_ID_PREFIX_LEGACY = 'avaso_pk_';
/** OAuth2 client_secret prefix. */
export const OAUTH_CLIENT_SECRET_PREFIX = 'avaso_csec_';
export const OAUTH_CLIENT_SECRET_PREFIX_LEGACY = 'avaso_sk_';

export const SYNC_WORKER_CLIENT_ID = 'avaso_cid_sync_worker';
export const SYNC_WORKER_CLIENT_ID_LEGACY = 'avaso_pk_sync_worker';
export const SYNC_WORKER_DISPLAY_NAME = 'sync-worker';

export function isGatewayOAuthClientId(id: string): boolean {
  return (
    id.startsWith(OAUTH_CLIENT_ID_PREFIX) || id.startsWith(OAUTH_CLIENT_ID_PREFIX_LEGACY)
  );
}

export function isSyncWorkerClient(nameOrId: string): boolean {
  return (
    nameOrId === SYNC_WORKER_DISPLAY_NAME ||
    nameOrId === SYNC_WORKER_CLIENT_ID ||
    nameOrId === SYNC_WORKER_CLIENT_ID_LEGACY
  );
}
