# Kiến trúc thực tế — 15 chức năng lớn (khớp code)

Middleware platform rút gọn (WSO2-inspired), viết **Rust**. Production: https://thientinh.io.vn

---

## Sơ đồ tổng thể

```
[Client App]
     │  HMAC + X-API-Key
     ▼
[Nginx TLS] ──► [AVASO Gateway :3000]
                    │
     ┌──────────────┼──────────────┐
     │ DATA PLANE   │ ADMIN PLANE  │
     │ /v1/api/*    │ /api/* + UI  │
     └──────┬───────┴──────┬───────┘
            ▼              ▼
      [Upstream]     [PostgreSQL]
      SF / Zoho      [Redis session/OTP]
```

**Forward proxy** = đại diện client (VPN). **Reverse proxy** = đại diện server — gateway là reverse proxy thông minh (API Gateway).

---

## A. Data plane (5 chức năng lớn)

### 1. API Gateway + Reverse Proxy

**Là gì:** Một cổng HTTP; client gọi `thientinh.io.vn`, gateway forward sang upstream.

**Code:** `handle_data_plane_request`, `do_proxy` — `src/main.rs`

**Ví dụ:** `GET /v1/api/orders` → `https://api.shop.com/orders`

**504:** Upstream timeout → `StatusCode::GATEWAY_TIMEOUT` — `src/proxy_ext.rs`

---

### 2. Định tuyến động (Dynamic Routing)

**Static (không làm):** Hardcode path trong Rust → mỗi đổi IP phải rebuild.

**Dynamic (đồ án):** Admin CRUD route trên Dashboard → lưu **PostgreSQL** → `reload_runtime_config()` nạp lại RAM **không restart**.

**Khớp path dài nhất:**

```text
Route A: /v1/api/*
Route B: /v1/api/users/profiles  ← được chọn (dài hơn)
Request: /v1/api/users/profiles
```

**Code:** `src/main.rs` (filter + `max_by_key(|r| r.path.len())`), CRUD `api_*_route`

**Không có:** SIGHUP, watch YAML, Redis Pub/Sub.

---

### 3. Xác thực client (HMAC-SHA256)

**Không dùng JWT** trên data plane.

**Luồng:**

1. Client ký: `HMAC(secret, api_key + timestamp + method + path + body)`
2. Gửi header: `X-API-Key`, `X-Timestamp`, `X-Signature`
3. Gateway: tra key → giải mã secret → verify chữ ký
4. Timestamp lệch > ~5 phút → 401 (chống replay)

**Code:** `verify_client_auth` — `src/main.rs`; `src/crypto.rs`; demo `web/src/lib/hmacSign.ts`, `ProxyTry.tsx`

---

### 4. Rate limiting (Token Bucket)

**Là gì:** Mỗi key/route có “xô token”; hết token → **429** + `Retry-After`.

**Ví dụ:** Key lộ, script bắn 10k req/s → gateway chặn, backend không sập.

**Code:** `TokenBucket` — `src/main.rs`; cấu hình global `config.yaml` + per-route `rate_limit_per_min`

---

### 5. Pipeline proxy (Transform + Retry + DLQ)

**Pipeline** = request đi qua chuỗi trạm trước/sau khi gọi upstream.

| Trạm | Việc làm |
|------|------------|
| Transform | Thêm/xóa header trước forward |
| Retry | 502/503/504/timeout → thử lại 2–3 lần |
| Queue/DLQ | Vẫn fail → hàng đợi in-memory, admin replay trên UI |

**Code:** `src/proxy_ext.rs`, `ProxyQueue.tsx`

**Hạn chế:** DLQ **mất khi restart** gateway.

---

## B. Observability (2 chức năng lớn)

### 6. Transaction log

**Ai:** Client / data plane. **Tần suất:** Mỗi request một dòng.

**Ghi gì:** method, path, status, duration_ms, api_key_masked, upstream, outcome.

**Cách ghi (thực tế):** Sau response → `tokio::spawn` → INSERT `gateway_transaction_logs` (PostgreSQL). **Không** qua Redis buffer.

**Code:** `log_gateway_transaction` — `src/main.rs`; `db::insert_transaction_log`

---

### 7. Audit log

**Ai:** Admin/Operator. **Tần suất:** Thưa (CRUD route, key, user, login fail…).

**Mục đích:** Truy trách nhiệm — ai xóa route, ai bị 403 khi Viewer gọi POST.

**Code:** `write_audit_event` — `src/admin_auth.rs`; bảng `audit_logs`

**Tách khỏi transaction log** — HĐ hay hỏi vì scale và mục đích khác nhau.

---

## C. Control plane (4 chức năng lớn)

### 8. Đăng nhập & session admin

Session ID trong **Redis** (`gw:session:{id}`), cookie **HttpOnly** + **Secure** (HTTPS).

**Code:** `src/session.rs`, `api_login` — `src/main.rs`

---

### 9. RBAC (Admin / Operator / Viewer)

| Role | Quyền |
|------|--------|
| Admin | Toàn quyền + user |
| Operator | Route, key, integration, logs |
| Viewer | Chỉ đọc |

**2 lớp:** UI ẩn menu + API trả **403** + ghi audit.

**Code:** `rbac_allow` — `src/admin_auth.rs`; `web/src/lib/rbac.ts`

---

### 10. Quản lý danh tính (Identity)

CRUD user, email, khóa tài khoản, **đăng ký Viewer**, **quên MK 3 bước** (username+email → OTP Brevo → pass mới).

**Code:** `api_*_user`, `password_reset.rs`, `ForgotPassword.tsx`, `Register.tsx`

---

### 11. Quản lý Client API Key

Tạo key, secret hiện **một lần**, lưu **AES-256-GCM** trong DB; tùy chọn upload qua **RSA envelope**.

**Code:** `api_*_client_key`, `src/gateway_rsa.rs`

---

## D. Tích hợp (2 chức năng lớn)

### 12. Salesforce OAuth + sync

Admin authorize → callback → token mã hóa PostgreSQL → sync snapshot CRM.

**Code:** `src/integrations.rs` (`SF_PROVIDER`)

### 13. Zoho Projects OAuth + sync

Tương tự — projects/tasks snapshot.

**Code:** `ZOHO_PROVIDER` — cùng engine OAuth, hai connector triển khai.

---

## E. Vận hành (2 chức năng lớn)

### 14. Admin Dashboard (SPA)

React: Overview, Routes, Keys, Users, Logs, Settings, Integrations, **Proxy Try** (sandbox HMAC), API Docs.

**Control plane** cấu hình **data plane** — không phải 8 app riêng.

### 15. Triển khai production & HA

- DigitalOcean Droplet + Nginx TLS + systemd
- Docker / `docker-compose.ha.yml` (2 gateway + Nginx LB)
- **Shared Redis session** → failover không đá login

---

## Phụ trợ — không đếm chức năng lớn

`/health`, metrics JSON, CORS, ghi nhớ username login, toast UI.

---

## Câu trả lời HĐ (tóm tắt)

- **Bao nhiêu chức năng lớn?** 15 phân hệ (bảng trên).
- **Khác WSO2?** Rút gọn enterprise; giữ route, security, throttle, log, admin, OAuth bridge; single-node + Docker HA; **Rust**.
- **Route đổi không restart?** Có — `reload_runtime_config` sau CRUD DB.
- **Auth client?** HMAC-SHA256, không JWT.
