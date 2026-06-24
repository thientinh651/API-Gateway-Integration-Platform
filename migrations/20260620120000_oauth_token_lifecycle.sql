-- OAuth token lifecycle: revoke, audit, authorization code (third-party apps)

ALTER TABLE gateway_client_keys
    ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE dashboard_users
    ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    jti TEXT PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants (id),
    subject TEXT NOT NULL,
    token_type TEXT NOT NULL,
    client_key_id BIGINT REFERENCES gateway_client_keys (id) ON DELETE SET NULL,
    user_id BIGINT REFERENCES dashboard_users (id) ON DELETE SET NULL,
    grant_type TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    source_ip TEXT,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_active_subject
    ON oauth_access_tokens (subject)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_active_client
    ON oauth_access_tokens (client_key_id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS oauth_third_party_apps (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants (id),
    client_id TEXT NOT NULL UNIQUE,
    client_secret_encrypted TEXT,
    name TEXT NOT NULL,
    redirect_uris_json TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT 'proxy:invoke',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code TEXT PRIMARY KEY,
    app_client_id TEXT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES dashboard_users (id),
    tenant_id BIGINT NOT NULL REFERENCES tenants (id),
    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS oauth_user_consents (
    user_id BIGINT NOT NULL REFERENCES dashboard_users (id),
    app_client_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, app_client_id)
);
