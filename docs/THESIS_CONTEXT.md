# CONTEXT ĐỒ ÁN — AVASO Gateway (khớp implementation thực tế)

> File này dùng paste cho AI / hội đồng / tự kiểm tra. Cập nhật: 2026-06.

---

## 1. Thông tin đề tài

| | |
|---|---|
| **Tên** | XÂY DỰNG NỀN TẢNG ĐA TÍCH HỢP TRÊN NGÔN NGỮ RUST |
| **SV** | Nguyễn Phúc Thiên Tinh — MSSV DH52201572 — D22_TH11 |
| **Demo** | https://thientinh.io.vn |
| **Stack** | Rust (Axum/Tokio/SQLx) + PostgreSQL 16 + Redis 7 + React/Vite + Nginx TLS |

**Định vị:** Sản phẩm chính = **API Gateway Platform**. Salesforce–Zoho = **use case minh họa** (~20–30% trình bày). **Không** trình bày SF-Zoho là sản phẩm trung tâm.

**Tỷ trọng bảo vệ:** ~70% Gateway · ~20% SF Connector · ~10% Zoho sync demo

---

## 2. Câu mô tả chuẩn

Hệ thống là nền tảng đa tích hợp bằng Rust, **chức năng cốt lõi là API Gateway**: định tuyến động, OAuth2/JWT, ACL, rate limiting, proxy, retry/DLQ, transaction/audit log, RBAC dashboard. Use case SF→Zoho minh họa khả năng mở rộng tích hợp.

---

## 3. Kiến trúc

```
Client → Nginx (TLS) → avaso-gateway :3000
  DATA PLANE: /v1/api/* , POST /api/oauth/token
    Auth: Authorization: Bearer JWT (secret CHỈ tại token endpoint)
  ADMIN PLANE: /api/* — cookie session (gw_sid) hoặc X-API-Key admin
  UI: React SPA (web/dist/)
```

| Thành phần | Lưu trữ |
|------------|---------|
| Route, client, user, log, integration, DLQ persist | PostgreSQL |
| Session admin, JWT revoke blacklist, rate limit bucket | Redis (`gw:session:*`, `gw:jwt:revoked:*`, `gw:rl:*`) |
| Proxy queue runtime | In-memory (flush/persist DLQ → PostgreSQL) |

---

## 4. Chức năng Gateway (CORE ~70%)

### 4.1 Dynamic Routing
Longest prefix, `{id}`, method filter, header transform, timeout, upstream proxy.

### 4.2 Client Registry (OAuth2 — KHÔNG phải HMAC mọi request)
- **Client ID** (`avaso_pk_…`) + **Client Secret** (`avaso_sk_…`) — prefix quy ước, không phải RSA key pair
- Secret **AES-256-GCM** at rest (`secret_encrypted`); key master từ env `CLIENT_KEY_MASTER_KEY`
- ACL: `gateway_client_key_routes` — rỗng = full tenant
- Tùy chọn: đăng ký qua RSA envelope (`POST /api/client-keys/encrypted`) — bổ sung, không thay JWT data plane

### 4.3 Authentication — OAuth2 JWT (CORE)
| Bước | Endpoint |
|------|----------|
| Đổi credential | `POST /api/oauth/token` — `client_credentials` (machine) hoặc `password` (user demo) |
| Data plane | `Authorization: Bearer JWT` trên `/v1/api/*` |

**Token lifecycle (đã implement):** `jti`, `tv`, revoke từng token, revoke toàn client, audit `oauth_access_tokens`, rate limit token endpoint (20/phút/client, 50/phút/IP).

### 4.4 Authorization Code — MỞ RỘNG (implement có giới hạn)

**Đã có (code chạy được):**
- Đăng ký app bên thứ 3: `POST /api/oauth/apps`
- `GET /oauth/authorize?client_id&redirect_uri&response_type=code&scope&state`
- Consent HTML + `POST /oauth/consent` (approve/deny)
- Lưu consent `oauth_user_consents`; phát `authorization_code` → redirect
- Đổi code: `POST /api/oauth/token` `grant_type=authorization_code`
- UI: tab **App bên thứ 3** + nút **Thử authorize**

**Giới hạn / không phải OAuth provider production:**
- User phải **đã login dashboard** (cookie `gw_sid`) — không có login page OAuth riêng cho end-user bên thứ 3
- **Không PKCE**
- App bên thứ 3 **tách** khỏi machine client (Client Registry)
- Token nhận được là **user JWT**, không phải client_credentials machine token

**Demo bảo vệ:** Có thể demo nếu cùng browser đã login admin + redirect URI đăng ký + curl đổi code. **Không** cam kết full OAuth2 provider đa tenant như Auth0. **Core demo:** `client_credentials` + Proxy Try.

### 4.5 ACL
JWT verify → kiểm tra `allowed_route_ids` → 403 trước upstream.

### 4.6 Rate Limiting — Token Bucket

**Ưu tiên:** Client `rate_limit_per_min` → Route `rate_limit_per_min` → Global (Settings: **RPS** + burst)

| Loại | Đơn vị |
|------|--------|
| Client / Route | req/**phút** |
| Global | **RPS** + burst (chỉ khi client=0 **và** route=0) |

**Burst cap:** `burst = max(3, per_min/10)` capped by `per_min` — demo throttle rõ, scale theo quota client.

**Storage:** Redis Lua token bucket (`gw:rl:*`); fallback RAM nếu Redis lỗi. **Chưa có** sliding window.

### 4.7 Retry + DLQ
Retry theo cấu hình route. DLQ: buffer in-memory → persist PostgreSQL. **Trade-off báo cáo:** đơn giản hóa; mất message trong cửa sổ ngắn nếu crash trước flush; replay idempotent; production cần WAL/Kafka.

### 4.8 Logging
Transaction log (`gateway_transaction_logs`), audit log (admin), sync log (integration).

### 4.9 RBAC
Admin / Operator / Viewer. **Hai lớp:** backend `admin_auth.rs` = enforcement; frontend `rbac.ts` = UX ẩn menu (không phải security boundary).

### 4.10 Monitoring — KHÔNG phải stub rỗng

**Đã có** (`src/metrics.rs`):
- Counter: `data_plane_requests`, success, denied, errors
- Histogram latency (buckets ms)
- `GET /metrics` — JSON mặc định; `?format=prometheus` — text Prometheus-compatible

**Chưa có / hạn chế:**
- Counter `rate_limit_hits` riêng
- Grafana/Prometheus scrape stack đầy đủ
- RED metrics toàn diện

### 4.11 Dashboard SPA
Tổng quan, Route, OAuth & Clients (3 tab), Proxy Try, Proxy Queue, API Docs, Integrations, Users, Logs, Settings.

### 4.12 Deploy
systemd + Nginx production; Docker Compose dev/HA demo.

---

## 5. Integration SF→Zoho (EXTENSION ~20–30%)

Closed Won → Project + Task; entity link chống trùng; sync log. **Luôn trình bày sau Gateway.**

---

## 6. Benchmark — TRUNG THỰC (quan trọng)

| Kịch bản | Ý nghĩa | Trạng thái số liệu |
|----------|---------|-------------------|
| `SCENARIO=health` | Runtime Rust + health handler — **KHÔNG** qua JWT/ACL/RL/proxy | ~877–1025 RPS @ 50–500 VU (đã đo) |
| `SCENARIO=jwt` | Full pipeline: JWT → ACL → RL → proxy upstream | Script có (`k6/benchmark.js`); **cần chạy và điền báo cáo** |
| Upstream direct | Baseline so overhead | Có script `benchmark-direct.js` |

**NFR ≥500 req/s:** Chứng minh bằng **JWT full pipeline**, không chỉ `/health`.

**NFR latency ≤10ms gateway overhead:** Cần số `latency(jwt pipeline) − latency(upstream direct)`.

---

## 7. Chương 4 — Test cases (tóm tắt)

TC_01–TC_05: OAuth2 JWT, token endpoint, rate limit 429, ACL  
TC_06–TC_09: routing, method, DLQ, transaction log  
TC_10–TC_12: session, RBAC, SF→Zoho sync  

Công cụ: `test_jwt_auth.py`, `smoke-test.sh`, k6, `rbac.test.ts`

---

## 8. Thuật ngữ — KHÔNG nhầm

| ❌ Cũ/sai | ✅ Đúng |
|-----------|---------|
| HMAC mọi request data plane | JWT Bearer |
| API Key / RSA pk/sk credential | OAuth2 Client ID + Secret |
| Global limit = req/phút | Global = **RPS** |
| Rate limit = ban vĩnh viễn | Token Bucket throttle + refill |
| `/metrics` stub rỗng | Metrics cơ bản có; chưa đủ observability production |
| SF-Zoho = sản phẩm chính | Gateway = sản phẩm chính |

---

## 9. Việc cần làm trước bảo vệ (đồng thuận)

| Ưu tiên | Việc |
|---------|------|
| **Ngày 1** | Chạy k6 `SCENARIO=jwt`, bảng 3 cột, overhead ms |
| **Ngày 2** | Báo cáo: DLQ trade-off, RBAC 2 lớp, secret reversible, burst=3 lý do |
| **Ngày 3** | (Tuỳ chọn) counter rate_limit trong metrics; TC_04 script Retry-After |

---

## 10. Hướng phát triển (chưa bắt buộc)

- Sliding window Redis
- PKCE + OAuth login page riêng cho third-party
- Hash one-way client_secret
- Abuse auto-disable sau N×429
- WAL/Kafka cho DLQ
- Grafana stack đầy đủ

---

## 11. File tham chiếu

| Chủ đề | Path |
|--------|------|
| OAuth2 | `docs/OAUTH2_IDENTITY.md` |
| Routing/JWT | `docs/ROUTING_JWT_CORE.md` |
| Rate limit | `src/rate_limit.rs` |
| Metrics | `src/metrics.rs` |
| Auth Code | `src/oauth_authorize.rs`, `src/oauth_handlers.rs` |
| Chương 4 | `docs/CHUONG_4_THU_NGHIEM.md` |
| Benchmark | `k6/benchmark.js`, `docs/BENCHMARK.md` |
| Ma trận FR | `docs/MA_TRAN_DO_AN.md` |
