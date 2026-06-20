-- Link traffic logs to Client Registry for drill-down / per-client stats.

ALTER TABLE gateway_transaction_logs
    ADD COLUMN IF NOT EXISTS client_key_id BIGINT REFERENCES gateway_client_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gw_tx_client_key
    ON gateway_transaction_logs (tenant_id, client_key_id, created_at DESC)
    WHERE client_key_id IS NOT NULL;
