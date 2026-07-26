-- ═══════════════════════════════════════════════════════════════════════════
-- Avaso Gateway — PostgreSQL schema (trạng thái cuối sau toàn bộ migrations/)
-- Tài liệu / ERD / báo cáo. Runtime áp schema qua sqlx migrate, không chạy file này.
-- Đồng bộ: migrations đến 20260717120000_route_array_columns.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ CORE / TENANTS ═══

CREATE TABLE tenants (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tenants (name) VALUES ('default') ON CONFLICT (name) DO NOTHING;

CREATE TABLE dashboard_users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin'
        CHECK (role IN ('admin', 'operator', 'viewer')),
    tenant_id BIGINT NOT NULL DEFAULT 1 REFERENCES tenants (id),
    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    email TEXT,
    token_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tenant_memberships (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES dashboard_users (id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, user_id)
);

-- ═══ GATEWAY DATA PLANE ═══

CREATE TABLE gateway_routes (
    id BIGSERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    target TEXT NOT NULL,
    timeout_secs INTEGER NOT NULL DEFAULT 30,
    rate_limit_per_min INTEGER NOT NULL DEFAULT 100,
    tenant_id BIGINT NOT NULL DEFAULT 1 REFERENCES tenants (id),
    transform_add_headers TEXT NOT NULL DEFAULT '{}',
    transform_remove_headers TEXT NOT NULL DEFAULT '[]',
    retry_max INTEGER NOT NULL DEFAULT 0,
    retry_on_status INTEGER[] DEFAULT ARRAY[502, 503, 504]::INTEGER[],
    retry_on_timeout INTEGER NOT NULL DEFAULT 1,
    queue_on_failure INTEGER NOT NULL DEFAULT 0,
    allowed_methods TEXT[] DEFAULT ARRAY['*']::TEXT[]
);

CREATE TABLE gateway_client_keys (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    secret_sha256_hex TEXT NOT NULL UNIQUE,
    api_key TEXT,
    secret_encrypted TEXT,
    tenant_id BIGINT NOT NULL DEFAULT 1 REFERENCES tenants (id),
    integration_type TEXT NOT NULL DEFAULT 'app',
    owner_user_id BIGINT REFERENCES dashboard_users (id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active',
    rate_limit_per_min INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    token_version INTEGER NOT NULL DEFAULT 0,
    secret_hash TEXT
);

CREATE TABLE gateway_client_key_routes (
    client_key_id BIGINT NOT NULL REFERENCES gateway_client_keys (id) ON DELETE CASCADE,
    route_id BIGINT NOT NULL REFERENCES gateway_routes (id) ON DELETE CASCADE,
    PRIMARY KEY (client_key_id, route_id)
);

CREATE TABLE gateway_settings (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);

-- tenant_id / route_id: không có FK trên DB migrate (giữ đúng hiện trạng)
CREATE TABLE gateway_transaction_logs (
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_key_id BIGINT REFERENCES gateway_client_keys (id) ON DELETE SET NULL,
    route_id BIGINT,
    req_headers TEXT,
    req_body TEXT,
    req_bytes BIGINT,
    req_truncated BOOLEAN NOT NULL DEFAULT FALSE,
    resp_headers TEXT,
    resp_body TEXT,
    resp_bytes BIGINT,
    resp_truncated BOOLEAN NOT NULL DEFAULT FALSE,
    upstream_url TEXT
);

-- route_id: không có FK trên DB migrate
CREATE TABLE gateway_proxy_queue (
    id TEXT PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants (id),
    route_id BIGINT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    upstream_url TEXT NOT NULL,
    headers_json TEXT NOT NULL DEFAULT '{}',
    body_b64 TEXT NOT NULL DEFAULT '',
    failure_reason TEXT NOT NULL,
    retry_attempts INTEGER NOT NULL DEFAULT 0,
    created_at_unix BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'pending',
    replayed_at TIMESTAMPTZ
);

-- ═══ ADMIN / AUDIT ═══

-- tenant_id: không có FK trên DB migrate
CREATE TABLE audit_logs (
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

-- ═══ OAUTH / IDENTITY ═══

CREATE TABLE oauth_pending_states (
    state TEXT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    provider TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'admin',
    pkce_verifier TEXT,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE oauth_access_tokens (
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

CREATE TABLE oauth_third_party_apps (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants (id),
    client_id TEXT NOT NULL UNIQUE,
    client_secret_encrypted TEXT,
    name TEXT NOT NULL,
    redirect_uris_json TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT 'proxy:invoke',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE oauth_authorization_codes (
    code TEXT PRIMARY KEY,
    app_client_id TEXT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES dashboard_users (id),
    tenant_id BIGINT NOT NULL REFERENCES tenants (id),
    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    code_challenge TEXT,
    code_challenge_method TEXT NOT NULL DEFAULT 'S256'
);

CREATE TABLE oauth_user_consents (
    user_id BIGINT NOT NULL REFERENCES dashboard_users (id),
    app_client_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, app_client_id)
);

-- ═══ INTEGRATION ═══

CREATE TABLE integration_providers (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'oauth2',
    capabilities_json TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE integration_flow_types (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    source_provider TEXT NOT NULL REFERENCES integration_providers (id),
    target_provider TEXT NOT NULL REFERENCES integration_providers (id),
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    config_schema_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO integration_providers (id, display_name, auth_type, capabilities_json)
VALUES
    ('salesforce', 'Salesforce', 'oauth2', '["crm","snapshot","webhook"]'),
    ('zoho_projects', 'Zoho Projects', 'oauth2', '["project","task"]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_flow_types (id, display_name, source_provider, target_provider, description, enabled)
VALUES (
    'sales_to_delivery',
    'Sales-to-Delivery Automation',
    'salesforce',
    'zoho_projects',
    'Closed Won Opportunity → Zoho Project + delivery tasks',
    1
)
ON CONFLICT (id) DO NOTHING;

-- tenant_id: không có FK trên DB migrate (DEFAULT 1)
CREATE TABLE integrations (
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

CREATE TABLE integration_provider_configs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    config_encrypted TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, provider)
);

CREATE TABLE integration_snapshots (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    record_count BIGINT NOT NULL DEFAULT 0,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sync_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1 REFERENCES tenants (id),
    status TEXT NOT NULL,
    message TEXT NOT NULL,
    error_detail TEXT,
    event_type TEXT,
    flow_type TEXT DEFAULT 'sales_to_delivery',
    source_provider TEXT,
    target_provider TEXT,
    correlation_id TEXT,
    metadata_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE integration_entity_links (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1 REFERENCES tenants (id),
    flow_type TEXT NOT NULL DEFAULT 'sales_to_delivery',
    source_provider TEXT NOT NULL DEFAULT 'salesforce',
    source_entity_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_provider TEXT NOT NULL DEFAULT 'zoho_projects',
    target_entity_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_name TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══ VIEWS ═══

CREATE OR REPLACE VIEW integration_tokens AS
SELECT
    i.id,
    i.tenant_id,
    i.provider,
    i.config_encrypted AS access_token_encrypted,
    i.config_encrypted AS refresh_token_encrypted,
    i.updated_at AS expires_at,
    i.updated_at
FROM integrations i
WHERE i.config_encrypted IS NOT NULL;

CREATE OR REPLACE VIEW salesforce_accounts_snapshot AS
SELECT
    id,
    tenant_id,
    payload_json,
    record_count,
    fetched_at
FROM integration_snapshots
WHERE provider = 'salesforce' AND entity_type = 'account';

-- ═══ UNIQUE INDEXES ═══

CREATE UNIQUE INDEX dashboard_users_email_lower_unique
    ON dashboard_users (LOWER(TRIM(email)))
    WHERE email IS NOT NULL AND TRIM(email) <> '';

CREATE UNIQUE INDEX idx_gateway_routes_tenant_path
    ON gateway_routes (tenant_id, path);

CREATE UNIQUE INDEX idx_gateway_client_keys_api_key
    ON gateway_client_keys (api_key)
    WHERE api_key IS NOT NULL;

CREATE UNIQUE INDEX idx_entity_links_source_unique
    ON integration_entity_links (tenant_id, flow_type, source_provider, source_entity_type, source_id);

-- ═══ PERFORMANCE INDEXES ═══

CREATE INDEX idx_dashboard_users_tenant_role
    ON dashboard_users (tenant_id, role);

CREATE INDEX idx_tenant_memberships_user
    ON tenant_memberships (user_id);

CREATE INDEX idx_client_keys_tenant_owner
    ON gateway_client_keys (tenant_id, owner_user_id);

CREATE INDEX idx_client_key_routes_route
    ON gateway_client_key_routes (route_id);

CREATE INDEX idx_gateway_client_keys_secret_hash
    ON gateway_client_keys (secret_hash)
    WHERE secret_hash IS NOT NULL AND secret_hash != '';

CREATE INDEX idx_client_keys_last_used
    ON gateway_client_keys (tenant_id, last_used_at DESC NULLS LAST);

CREATE INDEX idx_gw_tx_tenant_id
    ON gateway_transaction_logs (tenant_id, id DESC);

CREATE INDEX idx_gw_tx_client_key
    ON gateway_transaction_logs (tenant_id, client_key_id, created_at DESC)
    WHERE client_key_id IS NOT NULL;

CREATE INDEX idx_gw_tx_tenant_created
    ON gateway_transaction_logs (tenant_id, created_at DESC);

CREATE INDEX idx_gw_tx_tenant_outcome
    ON gateway_transaction_logs (tenant_id, outcome)
    WHERE outcome IS NOT NULL AND outcome != 'success';

CREATE INDEX idx_proxy_queue_tenant_created
    ON gateway_proxy_queue (tenant_id, created_at);

CREATE INDEX idx_proxy_queue_tenant_status
    ON gateway_proxy_queue (tenant_id, status);

CREATE INDEX idx_proxy_queue_status_created
    ON gateway_proxy_queue (status, created_at ASC);

CREATE INDEX idx_audit_logs_tenant_created
    ON audit_logs (tenant_id, id DESC);

CREATE INDEX idx_oauth_pending_expires
    ON oauth_pending_states (expires_at);

CREATE INDEX idx_oauth_access_tokens_active_subject
    ON oauth_access_tokens (subject)
    WHERE revoked_at IS NULL;

CREATE INDEX idx_oauth_access_tokens_active_client
    ON oauth_access_tokens (client_key_id)
    WHERE revoked_at IS NULL;

CREATE INDEX idx_integrations_tenant
    ON integrations (tenant_id);

CREATE INDEX idx_integration_provider_configs_tenant
    ON integration_provider_configs (tenant_id);

CREATE INDEX idx_integration_snapshots_tenant_provider
    ON integration_snapshots (tenant_id, provider, entity_type, fetched_at DESC);

CREATE INDEX idx_sync_logs_tenant_created
    ON sync_logs (tenant_id, id DESC);

CREATE INDEX idx_sync_logs_correlation
    ON sync_logs (tenant_id, correlation_id)
    WHERE correlation_id IS NOT NULL;

CREATE INDEX idx_sync_logs_event_type
    ON sync_logs (tenant_id, event_type, id DESC)
    WHERE event_type IS NOT NULL;

CREATE INDEX idx_entity_links_target
    ON integration_entity_links (tenant_id, target_provider, target_id);
