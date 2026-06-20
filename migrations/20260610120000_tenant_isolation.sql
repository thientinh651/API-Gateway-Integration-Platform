-- Per-tenant route paths + workspace membership (GitHub-style collaboration)

ALTER TABLE gateway_routes DROP CONSTRAINT IF EXISTS gateway_routes_path_key;
DROP INDEX IF EXISTS gateway_routes_path_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_routes_tenant_path
    ON gateway_routes (tenant_id, path);

CREATE TABLE IF NOT EXISTS tenant_memberships (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships(user_id);
