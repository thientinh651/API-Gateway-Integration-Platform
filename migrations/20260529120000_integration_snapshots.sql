-- Cached CRM/PM entity snapshots for reporting (pull from SF/Zoho via admin sync)

CREATE TABLE IF NOT EXISTS integration_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    record_count INTEGER NOT NULL DEFAULT 0,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_integration_snapshots_tenant_provider
  ON integration_snapshots (tenant_id, provider, entity_type, fetched_at DESC);
