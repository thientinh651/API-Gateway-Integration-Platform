# Kiểm tra nhanh — trạng thái hiện tại

Chạy từ thư mục repo: `cd /root/avaso-gateway`

---

## 1. Tổng quan

| Đã làm | Ghi chú |
|--------|---------|
| Argon2id admin password | `admin_users` |
| HMAC client key + AES secret | `gateway_client_keys` |
| Replay cache 5 phút | in-memory |
| RBAC admin / operator / viewer | BE + FE sync |
| Users API + UI | `/api/users` |
| Audit log + transaction log | SQLite + UI |
| Salesforce + Zoho OAuth | `integrations.rs` |
| Dashboard charts | Overview + `/api/dashboard/stats` |
| Transform / retry / DLQ | toggle Settings + Proxy Queue |
| Frontend | một thư mục `web/` → build `web/dist/` |
| Test | `cargo test` (21) + `cd web && npm test` (17) |
| CI | `.github/workflows/ci.yml` |
| Docker | `Dockerfile` + `docker-compose.yml` |

| Chưa / partial | Ghi chú |
|----------------|---------|
| F-15 `/reports` riêng | Thay bằng Overview — xem `docs/DEMO_BAO_VE.md` |
| Multi-tenant UI | Schema có, demo tenant 1 |
| Prometheus metrics | `/metrics` stub JSON |
| Session / DLQ persistent | in-memory — restart mất |

```bash
systemctl is-active avaso-gateway
curl -sS https://thientinh.io.vn/health
./scripts/smoke-test.sh
cargo test
cd web && npm test
```

---

## 2. Login + audit

```bash
curl -sS -X POST http://127.0.0.1:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' \
  -c /tmp/gw_cookies.txt -w '\nHTTP %{http_code}\n'

curl -sS http://127.0.0.1:3000/api/audit-logs?limit=5 -b /tmp/gw_cookies.txt | head -c 400
```

---

## 3. HMAC data-plane

Xem `docs/HUONG_DAN_TEST_CHI_TIET.md` mục 3–4 hoặc:

```bash
python3 scripts/test_hmac_replay.py
```

---

## 4. Deploy nhanh

```bash
cargo build --release
cd web && npm run build
sudo systemctl restart avaso-gateway
./scripts/smoke-test.sh
```

---

## 5. Checklist bảo vệ

| Yêu cầu | Kiểm tra |
|---------|----------|
| Password hash | Login + audit |
| HMAC + encrypted secret | UI Auth + DB |
| Replay | `test_hmac_replay.py` |
| RBAC operator | Routes: sửa OK, không tạo/xóa |
| SF/Zoho | Trang Tích hợp |
| Logs | Audit + Transaction (giờ VN) |

Demo script: **`docs/DEMO_BAO_VE.md`**

---

*Cập nhật: 2026-05-30*
