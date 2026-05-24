-- OAuth connectors (Salesforce, Zoho) per tenant

CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected',
    config_encrypted TEXT,
    last_sync_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON integrations (tenant_id);
