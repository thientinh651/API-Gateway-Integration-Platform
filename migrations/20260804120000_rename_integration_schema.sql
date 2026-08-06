-- Chuẩn hóa tên bảng/cột integration cho đúng bản chất.
-- Không đổi dữ liệu; chỉ RENAME. Idempotent khi đã apply.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'integrations'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'integration_connections'
  ) THEN
    ALTER TABLE integrations RENAME TO integration_connections;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'integration_connections' AND column_name = 'config_encrypted'
  ) THEN
    ALTER TABLE integration_connections
      RENAME COLUMN config_encrypted TO token_payload_encrypted;
  END IF;
END $$;

ALTER INDEX IF EXISTS idx_integrations_tenant
  RENAME TO idx_integration_connections_tenant;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'integration_provider_configs' AND column_name = 'config_encrypted'
  ) THEN
    ALTER TABLE integration_provider_configs
      RENAME COLUMN config_encrypted TO settings_encrypted;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sync_logs'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'integration_events'
  ) THEN
    ALTER TABLE sync_logs RENAME TO integration_events;
  END IF;
END $$;

ALTER INDEX IF EXISTS idx_sync_logs_tenant_created
  RENAME TO idx_integration_events_tenant_created;
ALTER INDEX IF EXISTS idx_sync_logs_correlation
  RENAME TO idx_integration_events_correlation;
ALTER INDEX IF EXISTS idx_sync_logs_event_type
  RENAME TO idx_integration_events_event_type;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'integration_entity_links' AND column_name = 'target_name'
  ) THEN
    ALTER TABLE integration_entity_links
      RENAME COLUMN target_name TO target_display_name;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'integration_entity_links' AND column_name = 'delivery_notified_at'
  ) THEN
    ALTER TABLE integration_entity_links
      RENAME COLUMN delivery_notified_at TO completion_synced_at;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'integration_entity_links' AND column_name = 'invoice_sf_id'
  ) THEN
    ALTER TABLE integration_entity_links
      RENAME COLUMN invoice_sf_id TO invoice_external_id;
  END IF;
END $$;
