# OAuth2 Identity Module

Gateway embed Identity Module theo RFC 6749 (token endpoint) + JWT RFC 7519.

## Thuật ngữ (tránh nhầm với RSA)

| Tên hiển thị | Field OAuth2 | Ví dụ | Ghi chú |
|--------------|--------------|-------|---------|
| **Client ID** | `client_id` | `avaso_pk_...` | Định danh client — **không** phải RSA public key |
| **Client Secret** | `client_secret` | `avaso_sk_...` | Shared secret — **không** phải RSA private key |
| **Gateway RSA public key** | `GET /api/crypto/public-key` | PEM | Chỉ cho envelope mã hóa đăng ký client (tùy chọn) |

Prefix `pk`/`sk` là quy ước đặt tên API credential (giống Stripe/AWS), không liên quan mật mã bất đối xứng client.

## Luồng xác thực

```
Client                          Gateway
  | POST /api/oauth/token          |
  | client_id + client_secret  --> | verify → phát JWT (HS256)
  |                                |
  | GET /v1/api/...                |
  | Authorization: Bearer JWT  --> | verify JWT → route → proxy upstream
```

- **Secret chỉ dùng tại token endpoint** — không gửi trên data plane `/v1/api/*`.
- Data plane: **Bearer JWT** mỗi request (hoặc cache token đến khi hết hạn).

## Token endpoint

```http
POST /api/oauth/token
Content-Type: application/x-www-form-urlencoded
```

Production nginx có thể alias `/oauth/token` → cùng handler.

### Machine client (web shop, script, k6)

```bash
curl -sS -X POST https://thientinh.io.vn/api/oauth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials&client_id=avaso_pk_xxx&client_secret=avaso_sk_xxx'
```

### User (demo / automation)

```bash
curl -sS -X POST http://127.0.0.1:3000/api/oauth/token \
  -d 'grant_type=password&username=admin&password=***'
```

Response:

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Rate limit token endpoint** (Token Bucket, Redis khi có):

| Bucket | Quota | Burst tối đa |
|--------|-------|----------------|
| Theo `client_id` | 20 req/phút | 3 |
| Theo IP nguồn | 50 req/phút | 3 |

Vượt ngưỡng → `429` + `Retry-After`. Bảo vệ CPU/DB khỏi spam đổi token.

Admin login (`POST /api/login`) cũng trả `access_token` trong JSON (cookie session giữ cho dashboard UI).

## Data plane

```http
GET /v1/api/get
Authorization: Bearer eyJ...
```

Gateway: validate JWT → rate limit (token bucket, burst ≤3) → match route → proxy upstream → trả response về client.

### Rate limit data plane

- Thuật toán: **Token Bucket** (giới hạn tốc độ trung bình, không khóa vĩnh viễn).
- Ưu tiên: **client** `rate_limit_per_min` → **route** → **global** (Settings).
- `burst = min(per_min, 3)` — demo trực quan hơn burst = full quota phút.
- Lưu counter: **Redis** (`gw:rl:*`) khi có; fallback **RAM** nếu Redis lỗi.
- Multi-instance: Redis đồng bộ quota giữa các gateway pod.

## Lưu trữ secret

- `client_secret` **mã hóa AES-256-GCM** trong PostgreSQL (`secret_encrypted`), không plaintext.
- Master key: env `CLIENT_KEY_MASTER_KEY`.
- Mật khẩu admin dashboard: **Argon2id** (khác luồng OAuth client).

## JWT

| Biến | Mặc định | Mô tả |
|------|----------|--------|
| `JWT_SECRET` | dev default | Ký + verify HS256 (monolith) |
| `JWT_EXPIRES_SECS` | `3600` | TTL access token |
| `JWT_ISSUER` | `avaso-gateway` | Claim `iss` |

**Hướng mở rộng:** RS256 — Auth Service giữ private key, gateway chỉ verify bằng public key (microservices).

## RSA envelope (tùy chọn)

`GET /api/crypto/public-key` trả **public key của gateway**. Client mã hóa payload đăng ký (`POST /api/client-keys/encrypted`).

- Bổ sung cho **HTTPS/TLS**, không thay OAuth2 trên data plane.
- Phù hợp demo enterprise / WSO2-style integration.

## Demo web (weather, shop)

1. Admin tạo OAuth client trên dashboard → copy Client ID + Client Secret (một lần).
2. App: `POST /api/oauth/token` (client_credentials).
3. App: `GET /v1/api/...` với `Authorization: Bearer`.
4. Response luôn qua gateway (không gọi thẳng upstream).

## Token lifecycle (revoke + audit)

Mỗi JWT có `jti` (ID duy nhất) và `tv` (token version).

| Tính năng | Endpoint | Mô tả |
|-----------|----------|--------|
| Revoke 1 token | `POST /api/oauth/revoke` body `token=` | Blacklist Redis + `revoked_at` trong DB |
| Logout Bearer | `POST /api/oauth/logout` + `Authorization: Bearer` | Revoke token đang dùng |
| Revoke toàn bộ client | `POST /api/client-keys/{id}/revoke-tokens` | Tăng `token_version` → mọi JWT cũ vô hiệu ngay |
| Audit token đang live | `GET /api/oauth/tokens?active_only=true` | Admin/operator — bảng `oauth_access_tokens` |
| Authorization Code + **PKCE S256** | `GET /oauth/authorize?code_challenge&code_challenge_method=S256` → consent → `POST /api/oauth/token` với `code_verifier` | App bên thứ 3 + consent user |
| Đăng ký app bên thứ 3 | `POST /api/oauth/apps` | `redirect_uris`, optional secret |

**Logout tức thì:** tăng `token_version` trên client/user (rotate secret, đổi mật khẩu, revoke-tokens) — JWT cũ trả `401 token_revoked` dù chưa hết `exp`.

**Lưu DB:** `oauth_access_tokens`, `oauth_third_party_apps`, `oauth_authorization_codes`, `oauth_user_consents`.

## Không làm

- Gửi `client_secret` trên mọi request `/v1/api/*`.
- Gọi `avaso_pk_` / `avaso_sk_` là “Public Key / Private Key RSA” trong báo cáo.
