# Kịch bản demo bảo vệ (~15 phút)

Production: https://thientinh.io.vn

## 0. Mở đầu (1 phút)

- Đề tài: Middleware platform rút gọn (WSO2-inspired), Rust
- **15 chức năng lớn** — slide [`KIEN_TRUC_THUC_TE.md`](KIEN_TRUC_THUC_TE.md)

## 1. Health & kiến trúc (2 phút)

```bash
curl -sS https://thientinh.io.vn/health
```

Giải thích: Nginx TLS → Gateway → PostgreSQL + Redis.

## 2. Data plane — HMAC + route (4 phút)

1. Mở **Proxy Try** — ký HMAC, gọi route
2. Hoặc terminal: `python3 scripts/test_hmac_replay.py`
3. Sửa signature → 401 (TC_02)

Nhấn: **HMAC không JWT**, longest prefix match.

## 3. Rate limit (1 phút)

Spam request → 429. Xem Logs transaction.

## 4. Admin — RBAC (3 phút)

1. Login **Admin** → CRUD route (không restart)
2. Login **Viewer** → không sửa route; Postman POST → 403

## 5. Quên mật khẩu (2 phút)

`/forgot-password`: username + email → OTP email (Brevo) → pass mới → login prefill username.

## 6. Tích hợp (2 phút)

**Integrations** → Salesforce / Zoho trạng thái + sync snapshot.

## 7. HA (tuỳ chọn, 2 phút)

```bash
docker compose -f docker-compose.ha.yml up -d
docker stop <gateway-1>
# F5 dashboard — vẫn chạy
```

Shared Redis session.

## 8. Kết — hạn chế thật

- DLQ in-memory
- Metrics JSON chưa Prometheus
- Transaction log async Postgres (chưa Redis buffer)

## Backup nếu mạng lỗi

- Screenshot UI trong slide
- `data/thesis-evidence/` log
- Video quay sẵn
