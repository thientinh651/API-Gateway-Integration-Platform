-- Ghi nhận hóa đơn Salesforce đã tạo khi dự án Zoho hoàn thành.
ALTER TABLE integration_entity_links
  ADD COLUMN IF NOT EXISTS invoice_sf_id TEXT;

ALTER TABLE integration_entity_links
  ADD COLUMN IF NOT EXISTS invoice_created_at TIMESTAMPTZ;
