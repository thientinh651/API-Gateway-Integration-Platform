# Tích hợp Zoho Projects

## Cấu hình (Dashboard)

1. Admin → **Integrations** → **(+)** Zoho Projects.
2. Nhập **Client ID**, **Client Secret**, **Redirect URI**, **Accounts URL**, **Scopes**.
3. **Lưu** → PostgreSQL `integration_provider_configs` (mã hóa).

Không dùng biến môi trường `ZOHO_CLIENT_*` — key/secret do admin nhập trên UI.

## OAuth & sync

Tương tự Salesforce:

1. **Connect** → đăng nhập Zoho → Allow.
2. **Test connection** → **Sync** projects/tasks.

**Code:** `src/integrations.rs` (`ZOHO_PROVIDER`)
