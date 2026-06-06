-- PostgreSQL schema (full gateway state)

CREATE TABLE IF NOT EXISTS tenants (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tenants (name) VALUES ('default') ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS gateway_routes (
    id BIGSERIAL PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    target TEXT NOT NULL,
    timeout_secs INTEGER NOT NULL DEFAULT 30,
    rate_limit_per_min INTEGER NOT NULL DEFAULT 100,
    tenant_id BIGINT NOT NULL DEFAULT 1 REFERENCES tenants(id),
    transform_add_headers TEXT NOT NULL DEFAULT '{}',
    transform_remove_headers TEXT NOT NULL DEFAULT '[]',
    retry_max INTEGER NOT NULL DEFAULT 0,
    retry_on_status TEXT NOT NULL DEFAULT '502,503,504',
    retry_on_timeout INTEGER NOT NULL DEFAULT 1,
    queue_on_failure INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gateway_client_keys (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    secret_sha256_hex TEXT NOT NULL UNIQUE,
    api_key TEXT,
    secret_encrypted TEXT,
    tenant_id BIGINT NOT NULL DEFAULT 1 REFERENCES tenants(id),
    integration_type TEXT NOT NULL DEFAULT 'app',
    owner_user_id BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_client_keys_api_key
    ON gateway_client_keys(api_key)
    WHERE api_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_keys_tenant_owner
    ON gateway_client_keys (tenant_id, owner_user_id);

CREATE TABLE IF NOT EXISTS gateway_settings (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    tenant_id BIGINT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1,
    actor TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    result TEXT NOT NULL,
    source_ip TEXT,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs (tenant_id, id DESC);

CREATE TABLE IF NOT EXISTS integrations (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected',
    config_encrypted TEXT,
    last_sync_at TIMESTAMPTZ,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON integrations (tenant_id);

CREATE TABLE IF NOT EXISTS integration_provider_configs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    config_encrypted TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_integration_provider_configs_tenant
    ON integration_provider_configs (tenant_id);

CREATE TABLE IF NOT EXISTS integration_snapshots (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    record_count BIGINT NOT NULL DEFAULT 0,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_snapshots_tenant_provider
    ON integration_snapshots (tenant_id, provider, entity_type, fetched_at DESC);

CREATE TABLE IF NOT EXISTS oauth_pending_states (
    state TEXT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    provider TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'admin',
    pkce_verifier TEXT,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_pending_expires ON oauth_pending_states (expires_at);

CREATE TABLE IF NOT EXISTS gateway_transaction_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT,
    request_id TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    client_ip TEXT,
    api_key_masked TEXT,
    outcome TEXT NOT NULL,
    reason TEXT NOT NULL,
    upstream TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gw_tx_tenant_id ON gateway_transaction_logs (tenant_id, id DESC);

CREATE TABLE IF NOT EXISTS integration_bridge_config (
    tenant_id BIGINT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    direction TEXT NOT NULL DEFAULT 'salesforce_to_zoho',
    mappings_json TEXT NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
