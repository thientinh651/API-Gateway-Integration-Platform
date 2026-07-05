-- Capture upstream request/response detail on gateway_transaction_logs so the
-- Route/Traffic log tab can show full request + response for each proxied call.
-- Bodies are truncated at the application layer and sensitive headers redacted.

ALTER TABLE gateway_transaction_logs ADD COLUMN IF NOT EXISTS route_id BIGINT;
ALTER TABLE gateway_transaction_logs ADD COLUMN IF NOT EXISTS req_headers TEXT;
ALTER TABLE gateway_transaction_logs ADD COLUMN IF NOT EXISTS req_body TEXT;
ALTER TABLE gateway_transaction_logs ADD COLUMN IF NOT EXISTS req_bytes BIGINT;
ALTER TABLE gateway_transaction_logs ADD COLUMN IF NOT EXISTS req_truncated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE gateway_transaction_logs ADD COLUMN IF NOT EXISTS resp_headers TEXT;
ALTER TABLE gateway_transaction_logs ADD COLUMN IF NOT EXISTS resp_body TEXT;
ALTER TABLE gateway_transaction_logs ADD COLUMN IF NOT EXISTS resp_bytes BIGINT;
ALTER TABLE gateway_transaction_logs ADD COLUMN IF NOT EXISTS resp_truncated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE gateway_transaction_logs ADD COLUMN IF NOT EXISTS upstream_url TEXT;
