import { describe, expect, it } from 'vitest';
import {
  isGatewayOAuthClientId,
  isSyncWorkerClient,
  OAUTH_CLIENT_ID_PREFIX,
  OAUTH_CLIENT_SECRET_PREFIX,
} from './oauthClientId';

describe('oauthClientId', () => {
  it('accepts new and legacy client_id prefixes', () => {
    expect(isGatewayOAuthClientId(`${OAUTH_CLIENT_ID_PREFIX}abc`)).toBe(true);
    expect(isGatewayOAuthClientId('avaso_pk_old')).toBe(true);
    expect(isGatewayOAuthClientId('random')).toBe(false);
  });

  it('detects sync worker by display name or client_id', () => {
    expect(isSyncWorkerClient('sync-worker')).toBe(true);
    expect(isSyncWorkerClient('avaso_cid_sync_worker')).toBe(true);
    expect(isSyncWorkerClient('avaso_pk_sync_worker')).toBe(true);
    expect(isSyncWorkerClient('other')).toBe(false);
  });

  it('uses self-documenting secret prefix', () => {
    expect(OAUTH_CLIENT_SECRET_PREFIX).toBe('avaso_csec_');
  });
});
