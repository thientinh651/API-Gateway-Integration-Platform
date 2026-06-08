-- Thesis schema: integration_tokens (tokens vẫn mã hóa trong integrations.config_encrypted)
CREATE OR REPLACE VIEW integration_tokens AS
SELECT
    i.id,
    i.tenant_id,
    i.provider,
    i.config_encrypted AS access_token_encrypted,
    i.config_encrypted AS refresh_token_encrypted,
    i.updated_at AS expires_at,
    i.updated_at
FROM integrations i
WHERE i.config_encrypted IS NOT NULL;
