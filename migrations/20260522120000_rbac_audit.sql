-- RBAC: active flag, tenant backfill, client key purpose, audit trail

ALTER TABLE admin_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
UPDATE admin_users SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE gateway_client_keys ADD COLUMN integration_type TEXT NOT NULL DEFAULT 'app';

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    actor TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    result TEXT NOT NULL,
    source_ip TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs (tenant_id, id DESC);
