-- Extensible integration schema: generic entity links, typed events, flow/provider catalog.
-- POC salesforce → zoho_projects maps to flow_type = 'sales_to_delivery'.

-- ── Provider & flow catalog (reference data for multi-connector expansion) ──

CREATE TABLE IF NOT EXISTS integration_providers (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'oauth2',
    capabilities_json TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_flow_types (
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

-- ── sync_logs → integration events (additive columns, keep table name) ──

ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS flow_type TEXT DEFAULT 'sales_to_delivery';
ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS source_provider TEXT;
ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS target_provider TEXT;
ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS metadata_json TEXT;

CREATE INDEX IF NOT EXISTS idx_sync_logs_correlation
    ON sync_logs (tenant_id, correlation_id)
    WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_logs_event_type
    ON sync_logs (tenant_id, event_type, id DESC)
    WHERE event_type IS NOT NULL;

-- Backfill flow_type for existing rows
UPDATE sync_logs SET flow_type = 'sales_to_delivery' WHERE flow_type IS NULL;

-- ── integration_entity_links → provider-agnostic mapping ──

ALTER TABLE integration_entity_links ADD COLUMN IF NOT EXISTS flow_type TEXT NOT NULL DEFAULT 'sales_to_delivery';
ALTER TABLE integration_entity_links ADD COLUMN IF NOT EXISTS source_provider TEXT NOT NULL DEFAULT 'salesforce';
ALTER TABLE integration_entity_links ADD COLUMN IF NOT EXISTS source_entity_type TEXT;
ALTER TABLE integration_entity_links ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE integration_entity_links ADD COLUMN IF NOT EXISTS target_provider TEXT NOT NULL DEFAULT 'zoho_projects';
ALTER TABLE integration_entity_links ADD COLUMN IF NOT EXISTS target_entity_type TEXT;
ALTER TABLE integration_entity_links ADD COLUMN IF NOT EXISTS target_id TEXT;
ALTER TABLE integration_entity_links ADD COLUMN IF NOT EXISTS target_name TEXT;

UPDATE integration_entity_links
   SET source_entity_type = sf_entity_type,
       source_id = sf_id,
       target_entity_type = COALESCE(zoho_entity_type, 'project'),
       target_id = zoho_id,
       target_name = zoho_name
 WHERE source_id IS NULL;

ALTER TABLE integration_entity_links ALTER COLUMN source_entity_type SET NOT NULL;
ALTER TABLE integration_entity_links ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE integration_entity_links ALTER COLUMN target_entity_type SET NOT NULL;
ALTER TABLE integration_entity_links ALTER COLUMN target_id SET NOT NULL;

DROP INDEX IF EXISTS idx_entity_links_tenant_sf;
DROP INDEX IF EXISTS idx_entity_links_tenant_zoho;

ALTER TABLE integration_entity_links DROP CONSTRAINT IF EXISTS integration_entity_links_tenant_id_sf_entity_type_sf_id_key;

ALTER TABLE integration_entity_links DROP COLUMN IF EXISTS sf_entity_type;
ALTER TABLE integration_entity_links DROP COLUMN IF EXISTS sf_id;
ALTER TABLE integration_entity_links DROP COLUMN IF EXISTS zoho_entity_type;
ALTER TABLE integration_entity_links DROP COLUMN IF EXISTS zoho_id;
ALTER TABLE integration_entity_links DROP COLUMN IF EXISTS zoho_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_links_source_unique
    ON integration_entity_links (tenant_id, flow_type, source_provider, source_entity_type, source_id);

CREATE INDEX IF NOT EXISTS idx_entity_links_target
    ON integration_entity_links (tenant_id, target_provider, target_id);
