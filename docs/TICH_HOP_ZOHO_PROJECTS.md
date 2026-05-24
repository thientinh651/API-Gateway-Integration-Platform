# Tích hợp Zoho Projects — Hướng dẫn triển khai

**Phiên bản:** 1.0  
**Xem tổng quan:** [TICH_HOP_VA_BAO_CAO.md](./TICH_HOP_VA_BAO_CAO.md) §5.

---

## 1. Đăng ký ứng dụng Zoho

| Bước | Thao tác |
|------|----------|
| 1 | [api-console.zoho.com](https://api-console.zoho.com) → **ADD CLIENT** |
| 2 | Client Type: **Server-based Applications** |
| 3 | Homepage URL | `https://thientinh.io.vn` |
| 4 | Authorized Redirect URI | `https://thientinh.io.vn/api/integrations/zoho/callback` |
| 5 | Scope | `ZohoProjects.portals.READ`, `ZohoProjects.projects.READ`, `ZohoProjects.tasks.READ` |

**Data center:** Nếu tài khoản Zoho đăng ký tại EU → dùng `accounts.zoho.eu` và API domain tương ứng (xem response `api_domain` sau token).

## 2. Biến môi trường

```bash
INTEGRATION_MASTER_KEY="<cùng key với Salesforce>"
ZOHO_CLIENT_ID="1000...."
ZOHO_CLIENT_SECRET="..."
ZOHO_REDIRECT_URI="https://thientinh.io.vn/api/integrations/zoho/callback"
ZOHO_ACCOUNTS_URL="https://accounts.zoho.com"
```

## 3. Authorize URL

```
{ZOHO_ACCOUNTS_URL}/oauth/v2/auth
  ?scope=ZohoProjects.portals.READ,ZohoProjects.projects.READ,ZohoProjects.tasks.READ
  &client_id={ZOHO_CLIENT_ID}
  &response_type=code
  &access_type=offline
  &redirect_uri={ZOHO_REDIRECT_URI}
  &state={csrf_state}
```

## 4. Token exchange

```http
POST {ZOHO_ACCOUNTS_URL}/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

code={code}&grant_type=authorization_code
&client_id={ZOHO_CLIENT_ID}&client_secret={ZOHO_CLIENT_SECRET}
&redirect_uri={ZOHO_REDIRECT_URI}
```

Lưu encrypt:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "api_domain": "https://www.zohoapis.com",
  "expires_in_sec": 3600,
  "portal_id": null
}
```

Sau bước **test**: ghi `portal_id` vào config (portal mặc định hoặc portal đầu tiên user có quyền).

## 5. Refresh token

```http
POST {ZOHO_ACCOUNTS_URL}/oauth/v2/token
refresh_token={refresh_token}&grant_type=refresh_token
&client_id={ZOHO_CLIENT_ID}&client_secret={ZOHO_CLIENT_SECRET}
```

## 6. API thử (sau connect)

```http
GET {api_domain}/restapi/portal/
Authorization: Zoho-oauthtoken {access_token}
```

Chọn `portal_id` từ response → lưu config.

**Projects:**

```http
GET {api_domain}/restapi/portal/{portal_id}/projects/
```

**Tasks (một project):**

```http
GET {api_domain}/restapi/portal/{portal_id}/projects/{project_id}/tasks/
```

## 7. Map snapshot (báo cáo)

| entity_type | Nguồn | Field UI |
|-------------|--------|----------|
| `project` | projects list | `id`, `name`, `status`, `owner_name` |
| `task` | tasks list (multi-project: loop top 5 projects) | `id`, `name`, `status`, `due_date`, `project_id` |

## 8. Pattern copy từ Salesforce

Gateway Rust: cùng module `integrations` — enum provider `zoho_projects`, handlers mirror `/salesforce/*` → `/zoho/*`.

UI: card thứ hai trên `/integrations`; badge **Sắp có** cho đến khi handler `connect` deploy.

## 9. Acceptance (tuần 2)

- [ ] OAuth complete, `status=connected`
- [ ] `portal_id` trong config encrypted
- [ ] Sync → snapshot `project` và `task` với `record_count > 0`
- [ ] Tab Zoho trên `/reports` hiển thị bảng

## 10. Lỗi thường gặp

| Triệu chứng | Xử lý |
|-------------|--------|
| `invalid_code` | Code OAuth dùng một lần — connect lại |
| `INVALID_OAUTHSCOPE` | Bật đủ scope Projects trên console |
| 401 API Projects | Sai `api_domain` — dùng domain từ token response, không hard-code US |
| Empty portals | User Zoho không thuộc portal nào — đổi tài khoản test |

---

*Salesforce: [TICH_HOP_SALESFORCE.md](./TICH_HOP_SALESFORCE.md).*
