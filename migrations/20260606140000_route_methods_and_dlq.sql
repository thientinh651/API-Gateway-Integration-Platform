-- HTTP method filter per route + persistent DLQ
ALTER TABLE gateway_routes
    ADD COLUMN IF NOT EXISTS allowed_methods TEXT NOT NULL DEFAULT '*';

CREATE TABLE IF NOT EXISTS gateway_proxy_queue (
    id TEXT PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    route_id BIGINT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    upstream_url TEXT NOT NULL,
    headers_json TEXT NOT NULL DEFAULT '{}',
    body_b64 TEXT NOT NULL DEFAULT '',
    failure_reason TEXT NOT NULL,
    retry_attempts INTEGER NOT NULL DEFAULT 0,
    created_at_unix BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proxy_queue_tenant_created
    ON gateway_proxy_queue (tenant_id, created_at);
