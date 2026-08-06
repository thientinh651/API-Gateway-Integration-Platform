# OAuth2 Identity Module

Gateway embed Identity Module theo RFC 6749 (token endpoint) + JWT RFC 7519.

## Thuật ngữ

| Tên hiển thị | Field OAuth2 | Ví dụ | Ghi chú |
|--------------|--------------|-------|---------|
| **Client ID** | `client_id` | `avaso_cid_...` | Định danh ứng dụng (identifier) |
| **Client Secret** | `client_secret` | `avaso_csec_...` | Shared secret — chỉ gửi tới token endpoint |
| **Gateway RSA public key** | `GET /api/crypto/public-key` | PEM | Envelope mã hóa khi đăng ký client (tùy chọn) — không phải OAuth credential |

Prefix `cid` / `csec` = *client id* / *client secret*. Client cũ với `avaso_pk_` / `avaso_sk_` vẫn xác thực được cho đến khi rotate.

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
  -d 'grant_type=client_credentials&client_id=avaso_cid_xxx&client_secret=avaso_csec_xxx'
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

- **OAuth client Gateway** (`gateway_client_keys`): `client_secret` lưu dạng **Argon2id** (`secret_hash`), không plaintext. Không lưu bản mã hóa AES trên bảng này.
- **Ứng dụng bên thứ ba** (`oauth_third_party_apps`): `client_secret` mã hóa **AES-256-GCM** (`client_secret_encrypted`). Master key: env `CLIENT_KEY_MASTER_KEY`.
- Mật khẩu admin dashboard: **Argon2id** (`dashboard_users.password_hash`).

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

## Admin vs machine client

| | Dashboard admin | OAuth machine client |
|--|-----------------|----------------------|
| Auth | Session cookie `gw_sid` | Client ID + Secret → JWT |
| Path | `/api/...` | `/v1/api/...` |
| Subject | User (RBAC) | App (route ACL) |

## Token lifecycle / mở rộng

| Tính năng | Endpoint / cơ chế | Ghi chú |
|-----------|-------------------|---------|
| Audit token đang live | `GET /api/oauth/tokens?active_only=true` | Admin/operator — bảng `oauth_access_tokens` |
| Authorization Code + **PKCE S256** | `GET /oauth/authorize?code_challenge&code_challenge_method=S256` → (nếu chưa login: `/login?return_to=…`) → consent → `POST /api/oauth/token` với `code_verifier` | App bên thứ 3 + consent user |
| Đăng ký app bên thứ 3 | `POST /api/oauth/apps` | `redirect_uris`, optional secret |

**Logout tức thì:** tăng `token_version` trên client/user (rotate secret, đổi mật khẩu, revoke-tokens) — JWT cũ trả `401 token_revoked` dù chưa hết `exp`.

**Lưu DB:** `oauth_access_tokens`, `oauth_third_party_apps`, `oauth_authorization_codes`, `oauth_user_consents`.

## Không làm

- Gửi `client_secret` trên mọi request `/v1/api/*`.
- Nhầm Client ID/Secret với RSA key pair (RSA public key chỉ dùng envelope đăng ký).
- Gọi data plane bằng path thiếu prefix (vd `/phuluc` thay vì `/v1/api/phuluc`).
