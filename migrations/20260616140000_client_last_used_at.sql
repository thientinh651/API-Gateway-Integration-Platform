-- Client Registry: last activity timestamp for observability

ALTER TABLE gateway_client_keys
    ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_client_keys_last_used
    ON gateway_client_keys (tenant_id, last_used_at DESC NULLS LAST);
