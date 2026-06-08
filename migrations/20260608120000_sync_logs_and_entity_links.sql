-- Sync observability + SF↔Zoho entity idempotency

CREATE TABLE IF NOT EXISTS sync_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1 REFERENCES tenants(id),
    status TEXT NOT NULL,
    message TEXT NOT NULL,
    error_detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_tenant_created
    ON sync_logs (tenant_id, id DESC);

CREATE TABLE IF NOT EXISTS integration_entity_links (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1 REFERENCES tenants(id),
    sf_entity_type TEXT NOT NULL,
    sf_id TEXT NOT NULL,
    zoho_entity_type TEXT NOT NULL DEFAULT 'project',
    zoho_id TEXT NOT NULL,
    zoho_name TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, sf_entity_type, sf_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_links_tenant_zoho
    ON integration_entity_links (tenant_id, zoho_id);

-- Alias view matching thesis schema name (data lives in integration_snapshots)
CREATE OR REPLACE VIEW salesforce_accounts_snapshot AS
SELECT
    id,
    tenant_id,
    payload_json,
    record_count,
    fetched_at
FROM integration_snapshots
WHERE provider = 'salesforce' AND entity_type = 'account';
