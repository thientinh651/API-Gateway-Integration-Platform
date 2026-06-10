# Tích hợp Salesforce

## 1. Tạo Connected App (Salesforce)

1. Đăng nhập [Salesforce](https://login.salesforce.com) (hoặc Developer Edition).
2. **Setup** → **App Manager** → **New Connected App**.
3. Bật **Enable OAuth Settings**.
4. **Callback URL** — copy từ Dashboard → Integrations → Salesforce (hướng dẫn trong UI), ví dụ:

   ```
   https://thientinh.io.vn/api/integrations/salesforce/callback
   ```

5. **Selected OAuth Scopes:** `api`, `refresh_token`, `offline_access`.
6. **Quan trọng — IP gateway:** Setup → **Security** → **Network Access** → thêm IP public VPS (Dashboard hiển thị `GATEWAY_PUBLIC_IP`, ví dụ `146.190.106.155`).

   Hoặc Connected App → **Manage** → **Edit Policies** → **Relax IP restrictions** = bật.

7. Lưu Connected App → chờ ~2 phút → copy **Consumer Key** và **Consumer Secret**.

## 2. Kết nối trên Dashboard

1. Admin → **Integrations** → **(+)** Salesforce.
2. Làm theo hướng dẫn trong panel (copy Callback URL + IP).
3. Nhập **Consumer Key**, **Consumer Secret**, **Login URL** (`https://login.salesforce.com`).
4. Bấm **Kết nối Salesforce** — gateway lưu config mã hóa rồi chuyển OAuth.

## 3. Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách sửa |
|-------------|-------------|----------|
| `ip restricted` | IP VPS chưa whitelist | Network Access hoặc Relax IP |
| `redirect_uri_mismatch` | Callback URL sai | Copy y hệt từ Dashboard |
| `invalid_client` | Key/Secret sai hoặc app chưa active | Kiểm tra Connected App, chờ 2 phút |

## 4. Sync & test

Dashboard: **Test API limits** → **Đồng bộ snapshot**.

```bash
./scripts/test-integrations.sh
```

**Code:** `src/integrations.rs` (`SF_PROVIDER`)
