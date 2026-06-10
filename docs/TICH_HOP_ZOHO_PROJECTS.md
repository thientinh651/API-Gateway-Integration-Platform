# Tích hợp Zoho Projects

## 1. Tạo OAuth Client (Zoho)

1. [Zoho API Console](https://api-console.zoho.com) → **Add Client** → **Server-based Applications**.
2. **Redirect URI** — copy từ Dashboard → Integrations → Zoho, ví dụ:

   ```
   https://thientinh.io.vn/api/integrations/zoho/callback
   ```

3. Scopes: `ZohoProjects.portals.READ`, `ZohoProjects.projects.ALL`, `ZohoProjects.tasks.READ`, `ZohoProjects.tasks.CREATE`.
4. Copy **Client ID** và **Client Secret**.

## 2. Kết nối trên Dashboard

1. Admin → **Integrations** → **(+)** Zoho Projects.
2. Nhập Client ID, Secret, **Accounts URL** đúng region:
   - US: `https://accounts.zoho.com`
   - VN: `https://accounts.zoho.com.vn`
   - EU: `https://accounts.zoho.eu`
   - IN: `https://accounts.zoho.in`
3. Bấm **Kết nối Zoho Projects**.

## 3. Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách sửa |
|-------------|-------------|----------|
| `token_exchange_failed` | Secret/Redirect/Accounts URL sai | Kiểm tra console + form |
| Sync `401 INVALID_OAUTHTOKEN` | Token hết hạn | Ngắt kết nối → Kết nối lại |

## 4. Sync & test

**Test portals** → **Đồng bộ snapshot** → (cùng SF) **Sync Now**.

**Code:** `src/integrations.rs` (`ZOHO_PROVIDER`)
