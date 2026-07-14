# Tổng quan đồ án AVASO Gateway & Đánh giá tổng thể

> Tài liệu tổng hợp: những gì đã làm được (mục 1–11), đánh giá hội đồng, điểm mạnh/yếu, khuyến nghị trước bảo vệ.  
> Cập nhật: 2026-07-01

---

## 1. Đồ án này là gì?

**AVASO Gateway** là hệ thống **API Gateway đa tích hợp**, xây dựng cho **đồ án tốt nghiệp** (Nguyễn Phúc Thiên Tinh, MSSV DH52201572, lớp D22_TH11).

**Định vị chính thức:**
- **~70%** = API Gateway Platform (routing, auth, rate limit, proxy, retry, DLQ, dashboard)
- **~20%** = Salesforce Connector
- **~10%** = Pipeline đồng bộ SF → Zoho Projects (minh họa khả năng mở rộng)

**Demo production:** https://thientinh.io.vn

**Stack:**

| Thành phần | Công nghệ |
|---|---|
| Backend | Rust (Axum, Tokio, SQLx) |
| Database | PostgreSQL 16 |
| Cache/Session | Redis 7 |
| Frontend | React 18, TypeScript, Vite 6, Tailwind 4 |
| Deploy | Docker Compose, systemd, Nginx TLS |
| Observability | Prometheus + Grafana (tùy chọn) |

---

## 2. Hành trình phát triển

| Giai đoạn | Nội dung |
|---|---|
| **Khởi đầu** | Gateway Rust cơ bản ("Hello World") |
| **Giai đoạn 1** | Thêm web admin React, xác thực, hash mật khẩu |
| **Giai đoạn 2** | Tích hợp Salesforce + Zoho, dashboard responsive |
| **Giai đoạn 3** | Hardening: logs, tests, CI, frontend thống nhất |
| **Giai đoạn 4** | OAuth2: PKCE, client secret Argon2id, token lifecycle |
| **Giai đoạn 5** | DLQ persist PostgreSQL, proxy queue status, observability |
| **Giai đoạn 6** | Multi-tenant workspace, RBAC backend enforcement |
| **Giai đoạn 7 (30/6)** | Refactor integration — bỏ Zoho Office/bridge, tập trung pipeline SF→Zoho |

Commit mới nhất: `fix intergration` (30/6/2026).

---

## 3. Kiến trúc hệ thống

```
Client → Nginx (TLS) → avaso-gateway :3000
           ├── /health, /metrics          → health check + metrics
           ├── /oauth/token, /oauth/authorize → phát JWT / OAuth flow
           ├── /v1/api/*                   → DATA PLANE (JWT Bearer → proxy)
           ├── /api/*                      → ADMIN PLANE (session / API key)
           └── /*                          → React SPA (web/dist/)
```

| Plane | Prefix | Auth | Vai trò |
|---|---|---|---|
| **Data plane** | `/v1/api/*` | OAuth2 JWT Bearer | Reverse proxy, rate limit, ACL, transform, retry, DLQ |
| **Admin plane** | `/api/*` | Cookie `gw_sid` (Redis) hoặc `X-API-Key` | CRUD route, client keys, users, logs, integrations, settings |

**Lưu trữ state:**
- **PostgreSQL**: routes, users, client keys, integrations, snapshots, sync logs, entity links, transaction/audit logs, DLQ persist
- **Redis**: session admin (TTL 24h), rate limit distributed, JWT revocation
- **In-memory**: buffer proxy queue trước khi flush xuống PostgreSQL

---

## 4. Backend — những gì đã implement

### 4.1 Gateway Core (~65%)

- Dynamic routing: longest-prefix, `{id}`, method filter, header transform, per-route timeout
- Reverse proxy: strip Authorization, preserve query string, path param substitution
- Resilience: retry (status/timeout, exponential backoff), DLQ persist PostgreSQL, replay idempotent
- Runtime config reload (`POST /api/reload-config`), graceful shutdown

### 4.2 OAuth2 Identity & Token Lifecycle (~60%)

- Token endpoint: `client_credentials`, `password`, `authorization_code` + PKCE S256
- JWT data plane: HS256 claims, secret chỉ tại token endpoint
- Token lifecycle: revoke per-`jti`, bump `token_version`, audit, rate limit token endpoint
- Authorization Code + PKCE (mở rộng, có giới hạn — không phải full IdP production)

### 4.3 Security & Access Control (~55%)

- Argon2id password + client secret; AES-256-GCM integration config; RSA envelope tạo client key
- RBAC 3 role backend enforcement: `admin` / `operator` / `viewer`
- Multi-tenant isolation, ACL whitelist, admin API key, password reset OTP

### 4.4 Rate Limiting (~50%)

- Token bucket hybrid: Redis Lua + in-memory fallback
- Ưu tiên: Client → Route → Global RPS; 429 + `Retry-After`

### 4.5 Observability (~40%)

- Transaction log async, audit log, `/health`, `/metrics` JSON + Prometheus, Grafana dashboard

### 4.6 Admin API

- Public: login, register, forgot/reset password, OAuth token, SF/Zoho callback, feature flags
- Protected: CRUD routes/clients/users, workspace, logs, DLQ, integrations, OAuth admin, settings

---

## 5. Frontend — Dashboard React SPA

| Trang | Path | Quyền |
|---|---|---|
| Tổng quan | `/` | Tất cả |
| Routes | `/routes` | viewer+ |
| OAuth & Clients | `/auth` | operator+ |
| Proxy Try | `/proxy-try` | admin |
| Proxy Queue | `/proxy-queue` | operator+ |
| Tài liệu API | `/api-docs` | Public |
| Integrations | `/integrations` | admin |
| Users | `/users` | admin |
| Logs | `/logs` | admin |
| Settings | `/settings` | admin |
| Profile | `/profile` | Đăng nhập |

Integration UI (refactor 30/6): ConnectorCard, StatusStrip, PipelinePanel, Snapshots, SyncLogs, EntityLinks.

---

## 6. Tích hợp Salesforce ↔ Zoho (~25%)

**Salesforce:** OAuth2 + PKCE, snapshot Opportunity/Account, proxy `/v1/api/sf/*`, auto refresh token.

**Zoho Projects:** OAuth, list portals/projects/tasks, proxy `/v1/api/zoho/*`, push Project + Task.

**Pipeline SF → Zoho:**
1. Snapshot SF qua gateway loopback
2. Lọc Closed Won + Amount ≥ ngưỡng
3. Push Zoho Project/Task
4. Ghi sync_logs + entity_links (idempotent)

Background worker 15 phút hoặc Sync Now. Sync worker self-dogfood qua gateway loopback.

**Refactor 30/6:** Xóa Zoho Office, bridge, opportunity templates → pipeline core đơn giản hơn.

---

## 7. Multi-tenant / Workspace

- `tenants` + `tenant_memberships`, WorkspaceSwitcher UI
- Route unique per `(tenant_id, path)`, deployment mode `on_prem` | `saas`

---

## 8. Deploy & Operations

- Docker: compose dev, HA (2 instances + Nginx LB), observability (Prometheus/Grafana)
- Production: systemd, Nginx TLS `thientinh.io.vn`, tuning VPS 2GB
- Scripts: smoke-test, deploy-production, reset_integration_data, benchmark, collect-thesis-evidence
- CI: `.github/workflows/ci.yml` — cargo test + build + npm test + build

---

## 9. Benchmark & thử nghiệm

VPS DigitalOcean 2 vCPU / 2GB RAM (24/6/2026):

| Scenario | RPS | p50 (ms) | p95 (ms) |
|---|---|---|---|
| Upstream direct (mock) | 647 | 3.5 | 8.5 |
| `/health` | 2248 | 19.4 | 37.3 |
| JWT full pipeline | 275 | 143.2 | 780.1 |

Gateway overhead p50: ~139.7 ms @ 50 VUs.

---

## 10. Tài liệu đồ án

`MA_TRAN_DO_AN.md`, `THESIS_CONTEXT.md`, `BAO_CAO_DOAN_THIEU.md`, `CHUONG_4_THU_NGHIEM.md`, `BENCHMARK.md`, `OAUTH2_IDENTITY.md`, `ROUTING_JWT_CORE.md`, `RBAC_LVTN.md`, `TICH_HOP_SALESFORCE.md`, `schema_full_postgresql.sql`, ERD diagram.

---

## 11. Những gì CHƯA làm

| Tính năng | Trạng thái |
|---|---|
| Circuit breaker | Chưa |
| Sliding window rate limit | Chưa (chỉ token bucket) |
| Kafka/NATS DLQ scale-out | Chưa |
| Full OAuth IdP đa tenant | Chưa (có PKCE demo, giới hạn) |
| NFR latency ≤10ms @ 50 VUs | Chưa đạt (p50 ~140ms) |
| Distributed tracing (OpenTelemetry/Jaeger) | Chưa |

---

# Đánh giá tổng thể

Đồ án **khá mạnh đối với đồ án tốt nghiệp CNTT**, đặc biệt mức sinh viên đại học. Vượt phạm vi CRUD thông thường, chạm nhiều chủ đề hệ thống phân tán:

API Gateway · OAuth2 · JWT · Reverse Proxy · RBAC · Multi-tenant · Rate limiting · Retry/DLQ · Redis · PostgreSQL · Observability · SaaS workspace · Third-party integration · DevOps · Benchmarking

## Bảng chấm (góc nhìn hội đồng)

| Tiêu chí | Mức |
|---|---|
| Độ khó kỹ thuật | 9/10 |
| Khối lượng công việc | 9/10 |
| Tính thực tiễn | 8.5/10 |
| Tính nghiên cứu | 7.5/10 |
| Tính hoàn thiện sản phẩm | 8/10 |
| Tính học thuật | 7.5/10 |
| Mức phù hợp đồ án ĐH | 9.5/10 |

**Tổng thể: ~8.7–9.1/10**

---

## 5 điểm mạnh nhất

### 1. Định vị sản phẩm rõ

> 70% Gateway · 20% Salesforce connector · 10% Pipeline demo

**Cách trả lời nên giữ:**
> AVASO Gateway là API Gateway Platform. Salesforce–Zoho chỉ là use case chứng minh khả năng mở rộng.

### 2. Có production thật

VPS · Docker · Nginx · TLS · domain `thientinh.io.vn` — không chỉ localhost.

### 3. Multi-tenant + RBAC

Tenant, membership, workspace switch, effective role, ACL, RBAC backend — hiếm ở đồ án SV.

### 4. OAuth2 vượt mức "em dùng JWT"

PKCE, authorization code, client credentials, revocation, token lifecycle, audit, token version, Redis blacklist.

### 5. Benchmark thực tế

k6, wrk, p50/p95, RPS, VU, gateway overhead — phong cách sản phẩm thật.

---

## Những chỗ nên chỉnh (tránh hội đồng bắt bẻ)

### 1. Đừng gọi là Identity Provider

Nói: **"AVASO hiện thực một tập con OAuth2 phục vụ API Gateway"** hoặc **"OAuth2-enabled Gateway"**.

Chưa có: OIDC, JWKS, RS256, refresh token rotation, device flow, federation, discovery endpoint.

### 2. PKCE = demo authorization server

Giữ giới hạn: user phải login dashboard trước. Không claim "Production OAuth Authorization Server".

### 3. Salesforce–Zoho = use case, không phải sản phẩm chính

> Chương 5: Minh họa khả năng mở rộng của Gateway thông qua pipeline Salesforce → Zoho.

### 4. NFR latency — chuẩn bị câu trả lời

p50 143ms, overhead ~140ms. Giải thích: JWT validation, Redis rate limit, PG logging async, VPS 2GB. Hướng tối ưu: batching logs, Redis pipeline, route cache.

### 5. Observability = basic stack

Có metrics/health/Grafana/logs. Chưa có distributed tracing. Gọi **"basic observability stack"**.

---

## Góc nhìn doanh nghiệp

> Gateway MVP khá tốt — chứng minh Rust, concurrency, middleware, auth, infra.

Chưa phải Kong/Envoy/Traefik/Apigee — cần thêm circuit breaker, service discovery, WASM plugins, OpenAPI import, tracing, HA state replication, canary.

---

## 5 việc nên làm trước bảo vệ

1. **Sơ đồ kiến trúc** — Control Plane → Gateway Core → Redis → Postgres → Integrations → SF/Zoho
2. **Bảng NFR** — Availability/Auth/Multi-tenant/Retry/DLQ đạt; Latency ≤10ms và Circuit breaker chưa
3. **Sequence diagram** — JWT flow, OAuth flow, SF sync flow, DLQ replay flow
4. **Chuẩn bị Q&A** — Tại sao Rust? Tại sao không Kong/Envoy? Token bucket? Redis? Không Kafka? PG cho DLQ?
5. **Đổi tên module** — "Extension Connector Layer" thay vì "Integration Module"

---

## Tóm tắt một câu

**AVASO Gateway** là API Gateway production-ready cho scope đồ án — Rust async, admin SPA đầy đủ, OAuth2/JWT data plane, resilience (retry/DLQ), integration hub SF↔Zoho làm proof-of-concept. Deploy production tại https://thientinh.io.vn, có CI, benchmark, tài liệu tiếng Việt. Phase hiện tại: ổn định integration sau refactor 30/6.
