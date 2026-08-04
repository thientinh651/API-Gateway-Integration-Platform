-- Chiều ngược Zoho Projects → Salesforce (delivery_to_sales)
-- và dọn schema không còn dùng.

-- Catalog: flow báo dự án hoàn thành về Opportunity.
INSERT INTO integration_flow_types
  (id, display_name, source_provider, target_provider, description, enabled)
VALUES (
  'delivery_to_sales',
  'Delivery-to-Sales (Zoho → Salesforce)',
  'zoho_projects',
  'salesforce',
  'Zoho project status Đã hoàn tất → Salesforce Opportunity Project_Completed__c',
  1
) ON CONFLICT (id) DO NOTHING;

-- Idempotent: đã gửi tín hiệu hoàn thành về Salesforce trên link SF→Zoho.
ALTER TABLE integration_entity_links
  ADD COLUMN IF NOT EXISTS delivery_notified_at TIMESTAMPTZ;

-- Auth client dùng secret_hash (Argon2); cột sha256 chỉ còn giá trị filler.
ALTER TABLE gateway_client_keys
  DROP COLUMN IF EXISTS secret_sha256_hex;

-- View không được ứng dụng truy vấn.
DROP VIEW IF EXISTS integration_tokens;
DROP VIEW IF EXISTS salesforce_accounts_snapshot;
