-- Drop schema integration không còn dùng (Sales-to-Delivery Automation rebuild).
-- Xóa: bridge config, documents (Office/PDF), provider zoho_office.
-- Giữ: integrations, integration_provider_configs, integration_snapshots,
--       integration_entity_links, sync_logs (core pipeline).

DROP TABLE IF EXISTS integration_documents CASCADE;
DROP TABLE IF EXISTS integration_bridge_config CASCADE;

-- integrations: xóa dòng provider cũ không còn trong code
DELETE FROM integrations WHERE provider = 'zoho_office';

-- Snapshots bridge / template / contact không còn pipeline dùng
DELETE FROM integration_snapshots
 WHERE provider IN ('bridge', 'sales_to_delivery_templates')
    OR entity_type = 'contact';

-- Settings k/v liên quan Office / template (không còn code đọc)
DELETE FROM gateway_settings
 WHERE k LIKE 'zoho_office_%'
    OR k LIKE 'opportunity_templates%';
