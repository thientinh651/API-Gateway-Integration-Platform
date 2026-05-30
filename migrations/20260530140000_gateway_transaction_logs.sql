CREATE TABLE IF NOT EXISTS gateway_transaction_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    request_id TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    client_ip TEXT,
    api_key_masked TEXT,
    outcome TEXT NOT NULL,
    reason TEXT NOT NULL,
    upstream TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gw_tx_tenant_id ON gateway_transaction_logs (tenant_id, id DESC);
