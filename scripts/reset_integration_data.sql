-- RESET TÍCH HỢP — trắng tinh như doanh nghiệp mới lấy app.
-- Mục đích: xoá toàn bộ data/tokens/config cũ của SF & Zoho để admin cấu hình lại từ đầu.
--
-- Cảnh báo: destructive. Backup trước khi chạy.
-- Cách chạy:
--   psql "$DATABASE_URL" -f scripts/reset_integration_data.sql

BEGIN;

-- 1. Entity links (mapping Opportunity ↔ Project) — xoá hết
DELETE FROM integration_entity_links;

-- 2. Integration events (pipeline) — xoá hết
DELETE FROM integration_events;

-- 3. Snapshot đã pull về DB — xoá hết
DELETE FROM integration_snapshots;

-- 4. Token OAuth SF/Zoho (integration_connections.token_payload_encrypted) — clear + disconnect
UPDATE integration_connections
   SET token_payload_encrypted = NULL,
       status = 'disconnected',
       last_sync_at = NULL,
       last_error = NULL,
       updated_at = NOW()
 WHERE provider IN ('salesforce', 'zoho_projects');

-- 5. Cấu hình provider (client_id / client_secret / redirect_uri / scopes)
DELETE FROM integration_provider_configs
 WHERE provider IN ('salesforce', 'zoho_projects');

-- 6. Settings k/v liên quan Office / template (nếu còn sót)
DELETE FROM gateway_settings
 WHERE k LIKE 'zoho_office_%'
    OR k LIKE 'opportunity_templates%'
    OR k LIKE 'salesforce_provider_%'
    OR k LIKE 'zoho_provider_%';

-- 7. OAuth pending state của integration (nếu có)
DELETE FROM oauth_pending_states
 WHERE provider IN ('salesforce', 'zoho_projects');

COMMIT;

-- Verify
SELECT provider, status, (token_payload_encrypted IS NOT NULL) AS has_token
  FROM integration_connections
 ORDER BY provider;

SELECT COUNT(*) AS remaining_configs FROM integration_provider_configs;
SELECT COUNT(*) AS remaining_snapshots FROM integration_snapshots;
SELECT COUNT(*) AS remaining_links FROM integration_entity_links;
SELECT COUNT(*) AS remaining_events FROM integration_events;
