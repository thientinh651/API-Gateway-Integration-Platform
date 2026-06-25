-- DLQ lifecycle: pending → replayed | failed_permanent
ALTER TABLE gateway_proxy_queue
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE gateway_proxy_queue
    ADD COLUMN IF NOT EXISTS replayed_at TIMESTAMPTZ;

UPDATE gateway_proxy_queue SET status = 'pending' WHERE status = '';

CREATE INDEX IF NOT EXISTS idx_proxy_queue_tenant_status
    ON gateway_proxy_queue (tenant_id, status);
