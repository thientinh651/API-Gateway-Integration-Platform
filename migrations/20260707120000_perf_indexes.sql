-- Performance indexes for high-frequency query patterns

-- Transaction logs: time-range filtering (traffic stats, dashboard charts)
CREATE INDEX IF NOT EXISTS idx_gw_tx_tenant_created
    ON gateway_transaction_logs (tenant_id, created_at DESC);

-- Proxy queue: worker scan for pending items across all tenants
CREATE INDEX IF NOT EXISTS idx_proxy_queue_status_created
    ON gateway_proxy_queue (status, created_at ASC);

-- Transaction logs: outcome filter for dashboard deny-reason breakdown
CREATE INDEX IF NOT EXISTS idx_gw_tx_tenant_outcome
    ON gateway_transaction_logs (tenant_id, outcome)
    WHERE outcome IS NOT NULL AND outcome != 'success';
