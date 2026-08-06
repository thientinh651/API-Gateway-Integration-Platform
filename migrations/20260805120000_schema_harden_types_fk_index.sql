-- Schema harden: BOOLEAN + JSONB (plaintext) + FK + indexes.
-- Không đụng *_encrypted, req_body/resp_body, audit_logs.details.
-- Idempotent-ish: IF NOT EXISTS / DO blocks.

-- ═══ 0. Dọn orphan trước FK ═══

UPDATE gateway_transaction_logs t
SET route_id = NULL
WHERE route_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM gateway_routes r WHERE r.id = t.route_id);

-- Config provider không còn trong catalog (legacy junk).
DELETE FROM integration_provider_configs c
WHERE NOT EXISTS (SELECT 1 FROM integration_providers p WHERE p.id = c.provider);

-- Proxy queue: cho phép route_id NULL sau SET NULL khi xóa route.
ALTER TABLE gateway_proxy_queue
  ALTER COLUMN route_id DROP NOT NULL;

-- ═══ 1. BOOLEAN ═══

ALTER TABLE dashboard_users
  DROP CONSTRAINT IF EXISTS dashboard_users_is_active_check;

ALTER TABLE dashboard_users
  ALTER COLUMN is_active DROP DEFAULT,
  ALTER COLUMN is_active TYPE BOOLEAN USING (is_active <> 0),
  ALTER COLUMN is_active SET DEFAULT TRUE;

ALTER TABLE gateway_routes
  ALTER COLUMN retry_on_timeout DROP DEFAULT,
  ALTER COLUMN retry_on_timeout TYPE BOOLEAN USING (retry_on_timeout <> 0),
  ALTER COLUMN retry_on_timeout SET DEFAULT TRUE;

ALTER TABLE gateway_routes
  ALTER COLUMN queue_on_failure DROP DEFAULT,
  ALTER COLUMN queue_on_failure TYPE BOOLEAN USING (queue_on_failure <> 0),
  ALTER COLUMN queue_on_failure SET DEFAULT FALSE;

ALTER TABLE integration_flow_types
  ALTER COLUMN enabled DROP DEFAULT,
  ALTER COLUMN enabled TYPE BOOLEAN USING (enabled <> 0),
  ALTER COLUMN enabled SET DEFAULT TRUE;

-- ═══ 2. JSONB (plaintext only) ═══

ALTER TABLE gateway_routes
  ALTER COLUMN transform_add_headers DROP DEFAULT,
  ALTER COLUMN transform_add_headers TYPE JSONB USING transform_add_headers::jsonb,
  ALTER COLUMN transform_add_headers SET DEFAULT '{}'::jsonb;

ALTER TABLE gateway_routes
  ALTER COLUMN transform_remove_headers DROP DEFAULT,
  ALTER COLUMN transform_remove_headers TYPE JSONB USING transform_remove_headers::jsonb,
  ALTER COLUMN transform_remove_headers SET DEFAULT '[]'::jsonb;

ALTER TABLE gateway_proxy_queue
  ALTER COLUMN headers_json DROP DEFAULT,
  ALTER COLUMN headers_json TYPE JSONB USING headers_json::jsonb,
  ALTER COLUMN headers_json SET DEFAULT '{}'::jsonb;

ALTER TABLE oauth_third_party_apps
  ALTER COLUMN redirect_uris_json TYPE JSONB USING redirect_uris_json::jsonb;

ALTER TABLE integration_providers
  ALTER COLUMN capabilities_json DROP DEFAULT,
  ALTER COLUMN capabilities_json TYPE JSONB USING capabilities_json::jsonb,
  ALTER COLUMN capabilities_json SET DEFAULT '[]'::jsonb;

ALTER TABLE integration_flow_types
  ALTER COLUMN config_schema_json TYPE JSONB
  USING (
    CASE
      WHEN config_schema_json IS NULL OR btrim(config_schema_json) = '' THEN NULL
      ELSE config_schema_json::jsonb
    END
  );

ALTER TABLE integration_snapshots
  ALTER COLUMN payload_json TYPE JSONB USING payload_json::jsonb;

ALTER TABLE integration_events
  ALTER COLUMN metadata_json TYPE JSONB
  USING (
    CASE
      WHEN metadata_json IS NULL OR btrim(metadata_json) = '' THEN NULL
      ELSE metadata_json::jsonb
    END
  );

ALTER TABLE gateway_transaction_logs
  ALTER COLUMN req_headers TYPE JSONB
  USING (
    CASE
      WHEN req_headers IS NULL OR btrim(req_headers) = '' THEN NULL
      ELSE req_headers::jsonb
    END
  );

ALTER TABLE gateway_transaction_logs
  ALTER COLUMN resp_headers TYPE JSONB
  USING (
    CASE
      WHEN resp_headers IS NULL OR btrim(resp_headers) = '' THEN NULL
      ELSE resp_headers::jsonb
    END
  );

-- ═══ 3. Foreign keys ═══

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gw_tx_logs_tenant_id_fkey'
  ) THEN
    ALTER TABLE gateway_transaction_logs
      ADD CONSTRAINT gw_tx_logs_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gw_tx_logs_route_id_fkey'
  ) THEN
    ALTER TABLE gateway_transaction_logs
      ADD CONSTRAINT gw_tx_logs_route_id_fkey
      FOREIGN KEY (route_id) REFERENCES gateway_routes (id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gw_proxy_queue_route_id_fkey'
  ) THEN
    ALTER TABLE gateway_proxy_queue
      ADD CONSTRAINT gw_proxy_queue_route_id_fkey
      FOREIGN KEY (route_id) REFERENCES gateway_routes (id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_tenant_id_fkey'
  ) THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT audit_logs_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oauth_pending_states_tenant_id_fkey'
  ) THEN
    ALTER TABLE oauth_pending_states
      ADD CONSTRAINT oauth_pending_states_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_connections_tenant_id_fkey'
  ) THEN
    ALTER TABLE integration_connections
      ADD CONSTRAINT integration_connections_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_connections_provider_fkey'
  ) THEN
    ALTER TABLE integration_connections
      ADD CONSTRAINT integration_connections_provider_fkey
      FOREIGN KEY (provider) REFERENCES integration_providers (id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_provider_configs_tenant_id_fkey'
  ) THEN
    ALTER TABLE integration_provider_configs
      ADD CONSTRAINT integration_provider_configs_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_provider_configs_provider_fkey'
  ) THEN
    ALTER TABLE integration_provider_configs
      ADD CONSTRAINT integration_provider_configs_provider_fkey
      FOREIGN KEY (provider) REFERENCES integration_providers (id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_snapshots_tenant_id_fkey'
  ) THEN
    ALTER TABLE integration_snapshots
      ADD CONSTRAINT integration_snapshots_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oauth_authorization_codes_app_client_id_fkey'
  ) THEN
    ALTER TABLE oauth_authorization_codes
      ADD CONSTRAINT oauth_authorization_codes_app_client_id_fkey
      FOREIGN KEY (app_client_id) REFERENCES oauth_third_party_apps (client_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oauth_user_consents_app_client_id_fkey'
  ) THEN
    ALTER TABLE oauth_user_consents
      ADD CONSTRAINT oauth_user_consents_app_client_id_fkey
      FOREIGN KEY (app_client_id) REFERENCES oauth_third_party_apps (client_id) ON DELETE CASCADE;
  END IF;
END $$;

-- ═══ 4. Indexes ═══

CREATE INDEX IF NOT EXISTS idx_gw_tx_tenant_status_created
  ON gateway_transaction_logs (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gw_tx_request_id
  ON gateway_transaction_logs (request_id);

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_expires
  ON oauth_access_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_tenant_expires
  ON oauth_access_tokens (tenant_id, expires_at);
