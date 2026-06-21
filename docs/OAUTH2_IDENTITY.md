# OAuth2 Identity Module

Gateway embed Identity Module theo RFC 6749 (token endpoint) + JWT RFC 7519.

## Token endpoint

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded
```

### Machine client (web shop, script)

```bash
curl -sS -X POST http://127.0.0.1:3000/oauth/token \
  -d "grant_type=client_credentials&client_id=avaso_pk_xxx&client_secret=avaso_sk_xxx"
```

### User (demo / automation)

```bash
curl -sS -X POST http://127.0.0.1:3000/oauth/token \
  -d "grant_type=password&username=admin&password=***"
```

Response:

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

Admin login (`POST /api/login`) cũng trả `access_token` trong JSON (cookie session giữ cho dashboard UI).

## Data plane

```http
GET /v1/api/products
Authorization: Bearer eyJ...
```

Gateway: validate JWT → rate limit → match route → proxy upstream → trả response về client.

## Env

| Biến | Mặc định | Mô tả |
|------|----------|--------|
| `JWT_SECRET` | dev default | Ký HS256 |
| `JWT_EXPIRES_SECS` | `3600` | TTL access token |
| `JWT_ISSUER` | `avaso-gateway` | Claim `iss` |

## Demo web bán hàng

1. Admin tạo OAuth client trên dashboard
2. Web shop: `POST /oauth/token` (client_credentials)
3. Web shop: `GET /v1/api/...` với Bearer
4. Response luôn qua gateway (không gọi thẳng backend)
