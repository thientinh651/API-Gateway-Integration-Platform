# Tích hợp Salesforce — Hướng dẫn triển khai

**Phiên bản:** 1.0  
**Xem tổng quan:** [TICH_HOP_VA_BAO_CAO.md](./TICH_HOP_VA_BAO_CAO.md) §4.

---

## 1. Connected App (Sandbox khuyến nghị demo)

| Bước | Thao tác |
|------|----------|
| 1 | Login [Developer Edition / Sandbox](https://login.salesforce.com) |
| 2 | Setup → App Manager → **New Connected App** |
| 3 | API (Enable OAuth Settings) ✓ |
| 4 | Callback URL | `https://thientinh.io.vn/api/integrations/salesforce/callback` |
| 5 | Selected OAuth Scopes | `Manage user data via APIs (api)`, `Perform requests at any time (refresh_token, offline_access)` |
| 6 | Lưu → chờ 2–10 phút → copy **Consumer Key** → `SF_CLIENT_ID`, **Consumer Secret** → `SF_CLIENT_SECRET` |

## 2. Biến môi trường (`/etc/avaso-gateway/env`)

```bash
INTEGRATION_MASTER_KEY="<32-byte-base64>"
SF_CLIENT_ID="3MVG9..."
SF_CLIENT_SECRET="..."
SF_REDIRECT_URI="https://thientinh.io.vn/api/integrations/salesforce/callback"
# Tuỳ chọn sandbox:
SF_LOGIN_URL="https://test.salesforce.com"
```

## 3. Authorize URL (gateway build)

```
{SF_LOGIN_URL}/services/oauth2/authorize
  ?response_type=code
  &client_id={SF_CLIENT_ID}
  &redirect_uri={urlencode(SF_REDIRECT_URI)}
  &scope=api refresh_token
  &state={csrf_state}
```

## 4. Token exchange (callback)

```http
POST {SF_LOGIN_URL}/services/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={code}
&client_id={SF_CLIENT_ID}
&client_secret={SF_CLIENT_SECRET}
&redirect_uri={SF_REDIRECT_URI}
```

Lưu JSON response (encrypt):

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "instance_url": "https://yourInstance.my.salesforce.com",
  "issued_at": "...",
  "token_type": "Bearer"
}
```

## 5. API kiểm tra nhanh

```bash
# Sau khi connected — dùng token trong DB
GET {instance_url}/services/data/v59.0/limits
Authorization: Bearer {access_token}
```

Gateway endpoint: `GET /api/integrations/salesforce/test` (admin session).

## 6. SOQL sync (báo cáo)

```sql
SELECT Id, Name, StageName, Amount, CloseDate
FROM Opportunity
ORDER BY LastModifiedDate DESC
LIMIT 200
```

```http
GET {instance_url}/services/data/v59.0/query?q=SELECT+Id,Name,StageName,Amount,CloseDate+FROM+Opportunity+ORDER+BY+LastModifiedDate+DESC+LIMIT+200
```

Map → `integration_snapshots` entity_type `opportunity`.

## 7. Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Xử lý |
|-------------|-------------|--------|
| `redirect_uri_mismatch` | Callback khác Connected App | Khớp từng ký tự HTTPS |
| `invalid_client_id` | Dùng production URL với sandbox user | Đặt `SF_LOGIN_URL=test.salesforce.com` |
| `401` sau vài giờ | access_token hết hạn | Implement refresh trước sync |
| `INSUFFICIENT_ACCESS` | User OAuth thiếu quyền object | Profile/Permission set đọc Opportunity |

## 8. Acceptance (spike ngày 4)

- [ ] `integrations.provider=salesforce`, `status=connected`
- [ ] `length(config_encrypted) > 0`
- [ ] `/api/integrations/salesforce/test` → 200 + body có limits
- [ ] Audit `integration.connect` có trong `audit_logs`

---

*Zoho: [TICH_HOP_ZOHO_PROJECTS.md](./TICH_HOP_ZOHO_PROJECTS.md). Báo cáo UI: [TICH_HOP_VA_BAO_CAO.md](./TICH_HOP_VA_BAO_CAO.md) §6.*
