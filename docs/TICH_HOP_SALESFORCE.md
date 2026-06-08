# Tích hợp Salesforce

## 1. Tạo Connected App (Salesforce)

1. Đăng nhập [Salesforce](https://login.salesforce.com) (hoặc Developer Edition).
2. **Setup** → **App Manager** → **New Connected App**.
3. Bật **Enable OAuth Settings**.
4. **Callback URL** (bắt buộc khớp gateway):

   ```
   https://thientinh.io.vn/api/integrations/salesforce/callback
   ```

5. **Selected OAuth Scopes:** `Manage user data via APIs (api)`, `Perform requests at any time (refresh_token, offline_access)`.
6. Lưu → chờ vài phút → copy **Consumer Key** và **Consumer Secret**.

## 2. Cấu hình trên Dashboard (luồng chính)

1. Đăng nhập admin → **Integrations** → **(+)** Salesforce.
2. Nhập **Client ID** (Consumer Key), **Client Secret**, **Redirect URI**, **Login URL**.
3. Bấm **Lưu** — gateway mã hóa AES-GCM vào PostgreSQL (`integration_provider_configs`).

Secret không lưu plaintext; API chỉ trả `has_secret` + `secret_masked` (4 ký tự cuối).

## 3. OAuth Connect

1. Sau khi lưu config → **Connect**.
2. Đăng nhập Salesforce → Allow.
3. Redirect về `?ok=salesforce`.

Token OAuth (access/refresh) lưu riêng bảng `integrations`, mã hóa — không trùng với Client Secret.

## 4. Sync & test

Dashboard: **Test connection** → **Sync snapshot**.

```bash
./scripts/test-integrations.sh
```

## Script CLI (tùy chọn)

Tương đương bước Lưu trên UI — **không** ghi env:

```bash
./scripts/setup-salesforce.sh '<consumer_key>' '<consumer_secret>'
```

## Lưu ý bảo vệ

- Không commit secret vào git.
- Không đặt `SF_CLIENT_*` trong `/etc/avaso-gateway/env` — config theo tenant qua Dashboard.
- Chưa nhập Client ID/Secret → Connect/test trả `not configured` (đúng thiết kế).

**Code:** `src/integrations.rs` (`SF_PROVIDER`)
