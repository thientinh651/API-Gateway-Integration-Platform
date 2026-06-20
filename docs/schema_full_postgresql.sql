CREATE TABLE tenants (
    id BIGSERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE dashboard_users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    is_active INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    email TEXT
);

CREATE TABLE tenant_memberships (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    user_id BIGINT REFERENCES dashboard_users (id) NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE gateway_routes (
    id BIGSERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    target TEXT NOT NULL,
    timeout_secs INTEGER NOT NULL,
    rate_limit_per_min INTEGER NOT NULL,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    transform_add_headers TEXT NOT NULL,
    transform_remove_headers TEXT NOT NULL,
    retry_max INTEGER NOT NULL,
    retry_on_status TEXT NOT NULL,
    retry_on_timeout INTEGER NOT NULL,
    queue_on_failure INTEGER NOT NULL,
    allowed_methods TEXT NOT NULL
);

CREATE TABLE gateway_client_keys (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    secret_sha256_hex TEXT UNIQUE NOT NULL,
    api_key TEXT UNIQUE,
    secret_encrypted TEXT,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    integration_type TEXT NOT NULL,
    owner_user_id BIGINT REFERENCES dashboard_users (id),
    status TEXT NOT NULL,
    rate_limit_per_min INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ
);

CREATE TABLE gateway_client_key_routes (
    client_key_id BIGINT NOT NULL REFERENCES gateway_client_keys (id),
    route_id BIGINT NOT NULL REFERENCES gateway_routes (id),
    PRIMARY KEY (client_key_id, route_id)
);

CREATE TABLE gateway_settings (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);

CREATE TABLE gateway_transaction_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT REFERENCES tenants (id),
    request_id TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    duration_ms BIGINT NOT NULL,
    client_ip TEXT,
    api_key_masked TEXT,
    outcome TEXT NOT NULL,
    reason TEXT NOT NULL,
    upstream TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    client_key_id BIGINT REFERENCES gateway_client_keys (id)
);

CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    actor TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    result TEXT NOT NULL,
    source_ip TEXT,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE gateway_proxy_queue (
    id TEXT PRIMARY KEY,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    route_id BIGINT REFERENCES gateway_routes (id) NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    upstream_url TEXT NOT NULL,
    headers_json TEXT NOT NULL,
    body_b64 TEXT NOT NULL,
    failure_reason TEXT NOT NULL,
    retry_attempts INTEGER NOT NULL,
    created_at_unix BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE integrations (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    config_encrypted TEXT,
    last_sync_at TIMESTAMPTZ,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE integration_provider_configs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    provider TEXT NOT NULL,
    config_encrypted TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE oauth_pending_states (
    state TEXT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    provider TEXT NOT NULL,
    actor TEXT NOT NULL,
    role TEXT NOT NULL,
    pkce_verifier TEXT,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE integration_snapshots (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    provider TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    record_count BIGINT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE integration_bridge_config (
    tenant_id BIGINT PRIMARY KEY REFERENCES tenants (id),
    enabled INTEGER NOT NULL,
    direction TEXT NOT NULL,
    mappings_json TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE sync_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    status TEXT NOT NULL,
    message TEXT NOT NULL,
    error_detail TEXT,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE integration_entity_links (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    sf_entity_type TEXT NOT NULL,
    sf_id TEXT NOT NULL,
    zoho_entity_type TEXT NOT NULL,
    zoho_id TEXT NOT NULL,
    zoho_name TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE integration_documents (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT REFERENCES tenants (id) NOT NULL,
    sf_entity_type TEXT NOT NULL,
    sf_id TEXT NOT NULL,
    zoho_project_id TEXT,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    source_provider TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);


CREATE UNIQUE INDEX dashboard_users_email_lower_unique
    ON dashboard_users (LOWER(TRIM(email)))
    WHERE email IS NOT NULL AND TRIM(email) <> '';

CREATE UNIQUE INDEX idx_gateway_routes_tenant_path
    ON gateway_routes (tenant_id, path);

CREATE UNIQUE INDEX idx_gateway_client_keys_api_key
    ON gateway_client_keys (api_key) WHERE api_key IS NOT NULL;

CREATE UNIQUE INDEX idx_integrations_tenant_provider
    ON integrations (tenant_id, provider);

CREATE UNIQUE INDEX idx_integration_provider_configs_tenant_provider
    ON integration_provider_configs (tenant_id, provider);

CREATE UNIQUE INDEX idx_entity_links_tenant_sf
    ON integration_entity_links (tenant_id, sf_entity_type, sf_id);

CREATE UNIQUE INDEX idx_integration_documents_tenant_sf_provider
    ON integration_documents (tenant_id, sf_entity_type, sf_id, source_provider);

CREATE UNIQUE INDEX idx_tenant_memberships_tenant_user
    ON tenant_memberships (tenant_id, user_id);

