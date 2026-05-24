# Kế hoạch 4 ngày — Bảo mật, đa tenant, Salesforce (spike)

**Mục tiêu:** Trả lời feedback “chưa đúng hướng” với deliverable demo được, không ôm hết production.

**Đọc trước:** [MO_HINH_BAO_MAT.md](./MO_HINH_BAO_MAT.md) (hash vs encrypt vs OAuth).

**Giả định:** 1 dev, ~6h/ngày. Branch: `feat/security-4day`.

---

## Tổng quan 4 ngày

| Ngày | Trọng tâm | Demo cuối ngày |
|------|-----------|----------------|
| **1** | Password hash DB + doc bảo mật | Login admin, pass không còn plain trong env |
| **2** | `tenant_id` + RBAC middleware | Operator không POST route; data cách ly theo tenant |
| **3** | Users API thật + audit log | Tạo user trên UI → có trong SQLite + audit |
| **4** | Salesforce OAuth spike (+ Zoho stub) | “Connected” SF sandbox, 1 API thử |

**Không kịp trong 4 ngày (tuần 2):** Zoho OAuth đầy đủ, RSA sign request, 2 tenant demo production, Postgres migrate.

---

## Ngày 1 — Password có hash + nền tảng

### Sáng
- [ ] Backup: `cp data/gateway.db data/gateway.db.bak.$(date +%F)`
- [ ] Migration `admin_users`: `id`, `username` UNIQUE, `password_hash`, `role`, `tenant_id` (nullable tạm), `created_at`
- [ ] Crate `argon2`: `hash_password`, `verify_password`

### Chiều
- [ ] Bootstrap: bảng trống → user `admin` từ env **một lần**, hash Argon2id
- [ ] `admin_login` đọc DB, không `ADMIN_PASSWORD`
- [ ] Viết `docs/MO_HINH_BAO_MAT.md` (đã có — đọc + bổ sung nếu cần)
- [ ] Cập nhật `deploy/systemd/env.example`: ghi chú `ADMIN_PASSWORD` deprecated

### Xong khi
```bash
cargo build --release && sudo systemctl restart avaso-gateway
curl -sS -X POST http://127.0.0.1:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' -w '\n%{http_code}\n'
# → 200
sqlite3 data/gateway.db "SELECT username, length(password_hash) FROM admin_users;"
# → 1 row, password_hash dài (không phải 'admin')
```

---

## Ngày 2 — Tenant + RBAC (mỗi người một vùng dữ liệu)

### Sáng
- [ ] Migration `tenants` + `tenant_id` NOT NULL trên `gateway_routes`, `gateway_client_keys`
- [ ] Backfill `tenant_id = 1`, tenant name `default`
- [ ] `admin_users.tenant_id` FK → tenant 1

### Chiều
- [ ] Session login: lưu `tenant_id`, `role`
- [ ] Mọi CRUD route/key: filter `tenant_id = session.tenant_id`
- [ ] RBAC: `viewer` GET only; `operator` không DELETE user; `admin` full
- [ ] Rate limit key: `{tenant_id}:{route_id}:{key_hash}`

### Xong khi
- [ ] Tạo user `operator` role operator, login → GET routes OK, POST route → **403**
- [ ] `sqlite3 ... "SELECT path, tenant_id FROM gateway_routes;"` — có tenant_id

---

## Ngày 3 — Users thật + Audit

### Sáng
- [ ] API `GET/POST/PUT/DELETE /api/admin/users` (admin only, cùng tenant)
- [ ] `Users.tsx` bỏ mock, gọi API; form có `PasswordManagerTrap`

### Chiều
- [ ] Bảng `audit_logs` + ghi: login, CRUD route, key, user
- [ ] `AuditLogs.tsx` đọc API (list 50 mới nhất)
- [ ] Build web: `cd ExampleWeb && npm run build`

### Xong khi
- [ ] UI tạo `viewer1` → row trong `admin_users`
- [ ] Xóa route → 1 row `audit_logs`

---

## Ngày 4 — Salesforce spike (+ Zoho chuẩn bị)

### Sáng
- [ ] Migration `integrations` (`tenant_id`, `provider`, `config_encrypted`, `status`, `updated_at`)
- [ ] `INTEGRATION_MASTER_KEY` trong env — AES-256-GCM encrypt token
- [ ] Doc [TICH_HOP_SALESFORCE.md](./TICH_HOP_SALESFORCE.md) + [TICH_HOP_VA_BAO_CAO.md](./TICH_HOP_VA_BAO_CAO.md): Connected App, callback, scope, FR-I*

### Chiều
- [ ] `GET /api/integrations` — list trạng thái
- [ ] `GET /api/integrations/salesforce/connect` → redirect OAuth
- [ ] `GET /api/integrations/salesforce/callback` → lưu token encrypted
- [ ] **1** handler thử: vd `GET /api/integrations/salesforce/test` → gọi SF API limits
- [ ] Enum provider có `zoho_projects` — UI “Sắp có” (chưa OAuth)

### Demo 15 phút cho mentor
1. Login admin (pass từ DB hash)
2. Giải thích MO_HINH_BAO_MAT (30s): không hash key client-side
3. Operator 403 khi tạo route
4. Audit log sau thao tác
5. Màn hình “Salesforce connected” + test API

### Xong khi
```bash
sqlite3 data/gateway.db "SELECT provider, status, length(config_encrypted) FROM integrations;"
# → salesforce, connected, > 0
```

---

## Checklist gửi mentor (Phụ lục)

| Yêu cầu | Ngày | Trạng thái |
|---------|------|------------|
| Password hash trong DB | 1 | ☐ |
| API key: HTTPS + SHA-256 at rest (đã có) | — | ☑ code hiện tại |
| Không “hash key khi gửi” | 1 doc | ☐ đọc MO_HINH |
| Mỗi user/tenant tài nguyên riêng | 2–3 | ☐ |
| RBAC admin/operator/viewer | 2 | ☐ |
| Salesforce OAuth + token encrypt | 4 | ☑ code |
| Zoho Projects | Tuần 2 | ☐ planned |

---

## Tuần 2 (sau 4 ngày)

1. Zoho Projects OAuth — [TICH_HOP_ZOHO_PROJECTS.md](./TICH_HOP_ZOHO_PROJECTS.md) (copy pattern SF)
2. Dashboard `/integrations` + `/reports` — [TICH_HOP_VA_BAO_CAO.md](./TICH_HOP_VA_BAO_CAO.md) §6
3. Tenant thứ 2 — demo 2 khách hàng
4. Route proxy `/v1/sf/...` qua connector
5. (Tuỳ chọn) JWT access token thay session cookie cho SPA

---

## Lệnh hàng ngày

```bash
cd /root/avaso-gateway && cargo build --release && sudo systemctl restart avaso-gateway
journalctl -u avaso-gateway -n 50 --no-pager
sqlite3 data/gateway.db ".tables"
```

---

*File chi tiết 6 ngày (nếu có thêm thời gian): [KE_HOACH_THUC_HIEN.md](./KE_HOACH_THUC_HIEN.md)*
