-- Provider OAuth app configs (client_id/secret/redirect/scopes) per tenant

CREATE TABLE IF NOT EXISTS integration_provider_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    config_encrypted TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_integration_provider_configs_tenant
  ON integration_provider_configs (tenant_id);

