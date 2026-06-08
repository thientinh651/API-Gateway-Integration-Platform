# Mô hình bảo mật

## Hai mặt phẳng

| | Data plane | Admin plane |
|---|------------|-------------|
| Path | `/v1/api/*` | `/api/*` |
| Auth | HMAC + API key | Session cookie (Redis) |
| Actor | Machine client | Human admin |

## Data plane — HMAC

- Secret **không** gửi trên wire
- Bind: method + path + body + timestamp
- Replay window ~5 phút
- Key secret: **AES-256-GCM** at rest

## Admin plane

- Cookie **HttpOnly** + **Secure** (HTTPS)
- Session TTL 24h — Redis `gw:session:{id}`
- RBAC: admin > operator > viewer
- Mọi từ chối 403 → **audit log**

## Identity

- Password: **Argon2id**
- Quên MK: OTP Redis TTL 10 phút, email Brevo HTTPS
- OAuth SF/Zoho: token encrypted PostgreSQL

## Sơ đồ

Import Draw.io: [`diagrams/BAO_VE_KIEN_TRUC.drawio`](diagrams/BAO_VE_KIEN_TRUC.drawio)
