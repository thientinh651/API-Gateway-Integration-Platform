# Mô hình bảo mật Avaso Gateway

Tài liệu trả lời feedback mentor: **hash password**, **API key**, **public/private key**, **phân quyền**, **tích hợp**.

---

## 1. Hiểu đúng: không “hash API key khi gửi rồi server giải mã”

| Cách mentor có thể mô tả | Thực tế nên làm |
|--------------------------|-----------------|
| Client hash key → gửi → server “giải mã” | **Sai hướng.** Hash là một chiều, không giải mã được. |
| Gửi key dạng mã hóa, server decrypt | Chỉ hợp lý nếu dùng **mã hóa đối xứng** (AES) với secret chung — phức tạp, dễ lộ key master, **không** thay TLS. |

### Luồng data plane (đã triển khai): API Key + Secret + HMAC-SHA256

Giống AWS v4 / Shopee / Momo (bản đơn giản):

| Thành phần | Vai trò | Lưu DB |
|------------|---------|--------|
| **API_KEY** (`avaso_pk_…`) | Công khai, gửi header `X-API-Key` | **Plain** (định danh) |
| **SECRET_KEY** (`avaso_sk_…`) | Bí mật, chỉ hiện 1 lần khi tạo | **AES-256-GCM** (không phải Argon2 — xem dưới) |

**Vì sao SECRET không Argon2?** HMAC cần server **tính lại** chữ ký bằng secret thật. Argon2 một chiều → không verify HMAC được (khác password login).

**Client ký request:**

```
payload = "{api_key}\n{timestamp}\n{METHOD}\n{path}\n{body}"
signature = HMAC-SHA256(secret_key, payload)  → hex
```

**Headers:** `X-API-Key`, `X-Timestamp` (unix giây), `X-Signature` (hex). Lệch giờ tối đa ±300s.

**Chống replay:** Cache in-memory `(api_key, X-Signature)` TTL 300s — cùng chữ ký gửi lại trong cửa sổ → `401 replay_detected`.

**Path khi ký:** Bắt buộc gồm query string (`/v1/api/get?user_id=123`). Method viết hoa. Body rỗng = `""`.

**Tenant:** `gateway_client_keys.tenant_id` phải khớp `gateway_routes.tenant_id` → không thì `403`.

**Legacy:** Key cũ một chuỗi `avaso_…` vẫn chỉ cần `X-API-Key` (SHA-256 at rest, không HMAC).

Env: `CLIENT_KEY_MASTER_KEY` — master key mã hóa secret trong SQLite (production bắt buộc đặt).

### Password đăng nhập web (admin)

| Hiện tại | Chuẩn |
|----------|--------|
| So sánh plain với `ADMIN_PASSWORD` trong env | Lưu **Argon2id** trong bảng `admin_users`; login = verify hash |

Password gửi qua HTTPS lúc login là bình thường; **at rest** phải hash.

---

## 2. Public / Private (WSO2-style) — đã có trong gateway

Mô hình mentor mô tả: **client dùng public key mã hóa → chỉ server (private key) giải mã**.

### Đã triển khai (đăng ký credential / secret một lần)

| Bước | Ai | Việc |
|------|-----|------|
| 1 | Partner / UI | `GET /api/crypto/public-key` → PEM public |
| 2 | Client | JSON `{ name, integration_type, secret_key? }` → **RSA-OAEP-256** bọc AES key + **AES-256-GCM** bọc body |
| 3 | Gateway | Private key giải mã → tạo `avaso_pk_` + `avaso_sk_` (lưu secret AES at rest) |

API: `POST /api/client-keys/encrypted` body `{ "envelope": { encrypted_aes_key, nonce, ciphertext } }`.

UI: **Bảo mật & Auth** → **Tạo key (RSA / WSO2)**.

### Không dùng RSA cho

| Luồng | Dùng gì |
|-------|---------|
| Mọi request data plane `/v1/...` | **HTTPS + HMAC** (như AWS/WSO2 API key thông thường) |
| Login admin | Argon2 password |
| Salesforce / Zoho | **OAuth 2.0** + token AES trong DB |

### Khác với WSO2 full

WSO2 AM còn: Developer Portal, policies, JWT, mediation. Gateway simplified chỉ lấy **envelope encrypt** + **API key + HMAC** + **OAuth connector**.

---

## 3. Mỗi người chỉ đụng tài nguyên của mình

Mô hình **multi-tenant + RBAC**:

```
Tenant A                    Tenant B
├── admin_users             ├── admin_users
├── gateway_routes          ├── gateway_routes
├── gateway_client_keys     ├── gateway_client_keys
└── integrations (SF…)    └── integrations
```

- Mọi query admin: `WHERE tenant_id = :session_tenant_id`.
- Session sau login chứa `user_id`, `tenant_id`, `role`.
- Role: `admin` | `operator` | `viewer` — middleware chặn method/path.
- Data plane: mỗi client key gắn `tenant_id`; route chỉ match trong tenant đó.

---

## 4. Salesforce & Zoho

| Hệ thống | Cách tích hợp | Gateway làm gì |
|----------|---------------|----------------|
| **Salesforce** | OAuth 2.0 (Connected App) | Lưu token encrypted; proxy hoặc sync API qua connector |
| **Zoho Projects** | OAuth 2.0 Zoho | Tương tự; scope Projects API |

**Không** nhét `client_secret` / token vào frontend. Flow:

1. Admin bấm “Connect Salesforce” → redirect OAuth.
2. Callback → gateway đổi `code` lấy token → encrypt → SQLite.
3. Job/API sau dùng token decrypt trong memory, gọi SF API.

Zoho full flow = **tuần 2** nếu chỉ có 4 ngày (ngày 4 chỉ spike SF).

---

## 5. Tóm tắt 1 câu cho mentor

> Password: Argon2id trong DB. Client API: API_KEY plain + SECRET encrypted + HMAC-SHA256 qua HTTPS. Legacy key: SHA-256 at rest. Phân quyền: tenant_id + RBAC. Salesforce/Zoho: OAuth2, token mã hóa at rest.

---

*Xem thực hiện: [KE_HOACH_4_NGAY.md](./KE_HOACH_4_NGAY.md). Tích hợp SF/Zoho + báo cáo: [TICH_HOP_VA_BAO_CAO.md](./TICH_HOP_VA_BAO_CAO.md).*
