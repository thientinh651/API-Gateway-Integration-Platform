-- HMAC keys had secret_sha256_hex='' → UNIQUE violation on 2nd insert

UPDATE gateway_client_keys
SET secret_sha256_hex = 'hmac:' || COALESCE(api_key, 'id-' || id)
WHERE secret_encrypted IS NOT NULL
  AND secret_encrypted != ''
  AND (secret_sha256_hex = '' OR secret_sha256_hex IS NULL);
