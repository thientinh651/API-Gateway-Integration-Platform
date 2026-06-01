# Demo bảo vệ (~5 phút)

Production: https://thientinh.io.vn — local: http://127.0.0.1:3000

## 0. Chuẩn bị (trước khi vào phòng)

```bash
systemctl is-active avaso-gateway
curl -sS https://thientinh.io.vn/health
./scripts/smoke-test.sh
```

## 1. Đăng nhập + RBAC (1 phút)

- Mở dashboard → **Đăng nhập** admin
- (Tuỳ chọn) User operator: **Routes** — sửa route OK, không thấy nút **Thêm Route**
- **Settings** — operator chỉ xem, admin mới lưu được

## 2. Route + HMAC client (2 phút)

- **Quản lý Route** — show route `/v1/api/...` → upstream
- **Bảo mật & Auth** → tạo API key → copy pk/sk
- **Thử gọi Proxy** hoặc `scripts/test_hmac_replay.py` — 200 rồi replay → 401

## 3. Audit + Logs (1 phút)

- **Audit Logs** — login vừa rồi, filter success/failure
- **Transaction Logs** — request data-plane (timestamp giờ VN)

## 4. Tích hợp (1 phút, nếu đã OAuth)

- **Tích hợp** — SF/Zoho connected → Test / Sync
- **Tổng quan** — chart snapshot

## 5. Câu hỏi hay gặp

| Câu hỏi | Trả lời ngắn |
|---------|----------------|
| Replay attack? | Cache in-memory 5 phút + demo script |
| Restart mất gì? | Session, replay cache, DLQ — Settings ghi rõ |
| Multi-tenant? | Schema `tenant_id`, demo tenant 1 |
| F-15 Reports? | Dashboard Overview + `/api/dashboard/stats` |
| Test tự động? | `cargo test` + `cd web && npm test` + CI |
| NFR / benchmark? | `GET /metrics`; `./scripts/collect-thesis-evidence.sh` |
| Trace FR đồ án? | `docs/MA_TRAN_DONG_AN.md` |

## Docker (local demo)

```bash
cp .env.example .env
docker compose up --build
# → http://127.0.0.1:3000
```
