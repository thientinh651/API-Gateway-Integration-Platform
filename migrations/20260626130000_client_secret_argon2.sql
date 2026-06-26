-- Client secret: Argon2id one-way hash (OAuth2 client_credentials)

ALTER TABLE gateway_client_keys
    ADD COLUMN IF NOT EXISTS secret_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_gateway_client_keys_secret_hash
    ON gateway_client_keys (secret_hash)
    WHERE secret_hash IS NOT NULL AND secret_hash != '';
