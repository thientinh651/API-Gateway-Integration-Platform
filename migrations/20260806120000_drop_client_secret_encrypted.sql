-- Gateway OAuth clients: Argon2id secret_hash only.
-- Drop legacy AES column secret_encrypted (compat path removed in app).
-- Abort if any row still has ciphertext and no hash (must rotate/migrate first).

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM gateway_client_keys
        WHERE secret_encrypted IS NOT NULL
          AND btrim(secret_encrypted) <> ''
          AND (secret_hash IS NULL OR btrim(secret_hash) = '')
    ) THEN
        RAISE EXCEPTION
            'gateway_client_keys: secret_encrypted rows without secret_hash remain; migrate or rotate those clients before DROP';
    END IF;
END $$;

ALTER TABLE gateway_client_keys
    DROP COLUMN IF EXISTS secret_encrypted;
