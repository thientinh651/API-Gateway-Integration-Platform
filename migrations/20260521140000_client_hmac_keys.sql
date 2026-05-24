-- API Key (public id) + Secret Key (encrypted at rest for HMAC verify)

ALTER TABLE gateway_client_keys ADD COLUMN api_key TEXT;
ALTER TABLE gateway_client_keys ADD COLUMN secret_encrypted TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_client_keys_api_key
    ON gateway_client_keys(api_key)
    WHERE api_key IS NOT NULL;
