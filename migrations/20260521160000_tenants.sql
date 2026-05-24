-- Multi-tenant isolation for routes and client keys

CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO tenants (name) VALUES ('default');

ALTER TABLE gateway_routes ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gateway_client_keys ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
