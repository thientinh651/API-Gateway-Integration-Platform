# Session admin — Redis (production-lite)

**Cập nhật:** 2025-06 — pattern phù hợp AVASO Gateway (đồ án + demo production).

## Lựa chọn kiến trúc

| Hướng | AVASO |
|-------|--------|
| JWT thuần | Không — revoke/logout khó |
| Session microservice riêng | Sau này nếu scale; hiện module `session.rs` + Redis đủ |
| **Redis session + cookie** | **Đang dùng** — chuẩn admin UI |

## Luồng

```
Login → revoke session cũ (cùng user) → Redis SET gw:session:{id}
Mỗi /api/* → GET Redis + (mỗi ~60s) sync role/active từ SQLite → EXPIRE sliding TTL
Logout / đổi pass / disable user → DEL session (+ index user)
```

## Tính năng

| Tính năng | Mô tả |
|-----------|--------|
| Sliding TTL | `touch()` mỗi request hợp lệ — 24h không hoạt động mới hết |
| DB recheck | `SESSION_DB_RECHECK_SECS` (mặc định 60) — role/disable sync từ SQLite |
| Revoke | Login mới thu hồi session cũ; đổi pass/role/disable → `revoke_all_for_user` |
| Browser UI | Chỉ cookie — **không** gửi `X-API-Key` tự động |
| Automation | `X-API-Key` admin (curl) — tách khỏi session user |

## Cấu hình

| Biến | Mặc định |
|------|----------|
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `SESSION_DB_RECHECK_SECS` | `60` |

## Redis keys

- `gw:session:{uuid}` — JSON session
- `gw:user_sessions:{user_id}` — SET các session id (revoke all)

## Health

`GET /health` → `components.session_store` + `components.database`; `503` nếu degraded.

## Xem session

```bash
redis-cli KEYS 'gw:session:*'
redis-cli SMEMBERS 'gw:user_sessions:1'
redis-cli GET 'gw:session:<gw_sid>'
```
