# AVASO Gateway

## Thông tin sinh viên

| | |
|---|---|
| **Họ tên** | Nguyễn Phúc Thiên Tinh |
| **MSSV** | DH52201572 |
| **Lớp** | D22_TH11 |

---

## Giới thiệu

**AVASO Gateway** là hệ thống API Gateway đa tích hợp, phát triển cho đồ án tốt nghiệp. Hệ thống gồm backend Rust (Axum), cơ sở dữ liệu PostgreSQL, Redis cho session admin, và giao diện quản trị React SPA.

**Định vị chính thức:**

- **~70%** = API Gateway Platform (routing, auth, rate limit, proxy, retry, DLQ, dashboard)
- **~20%** = Salesforce Connector
- **~10%** = Pipeline đồng bộ SF → Zoho Projects (minh họa khả năng mở rộng)

> AVASO Gateway là **API Gateway Platform**. Salesforce–Zoho chỉ là use case chứng minh khả năng mở rộng.

**Demo production:** [https://thientinh.io.vn](https://thientinh.io.vn)

**Script Database:** [docs/schema_full_postgresql.sql](docs/schema_full_postgresql.sql)

**Bảng ERD Database:**

![Bảng ERD Database](docs/diagrams/Avaso%20Gateway.png)

### Công nghệ

| Thành phần | Công nghệ |
|------------|-----------|
| Backend | Rust (Axum, Tokio, SQLx) |
| Database | PostgreSQL 16 |
| Cache / Session | Redis 7 |
| Frontend | React 18, TypeScript, Vite 6, Tailwind 4 |
| Reverse proxy | Nginx (TLS) |
| Triển khai | systemd, Docker Compose |
| Observability | Prometheus + Grafana (tùy chọn) |

---

## 2. Hành trình phát triển

| Giai đoạn | Nội dung |
|-----------|----------|
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

Hệ thống tách **2 mặt phẳng (plane)** rõ ràng:

```
Client → Nginx (TLS) → avaso-gateway :3000
           ├── /health, /metrics          → health check + metrics
           ├── /oauth/token, /oauth/authorize → phát JWT / OAuth flow
           ├── /v1/api/*                   → DATA PLANE (JWT Bearer → proxy)
           ├── /api/*                      → ADMIN PLANE (session / API key)
           └── /*                          → React SPA (web/dist/)
```

| Plane | Prefix | Auth | Vai trò |
|-------|--------|------|---------|
| **Data plane** | `/v1/api/*` | OAuth2 JWT Bearer | Reverse proxy upstream, rate limit, ACL, transform, retry, DLQ |
| **Admin plane** | `/api/*` | Cookie `gw_sid` (Redis) hoặc `X-API-Key` | CRUD route, client keys, users, logs, integrations, settings |

**Lưu trữ state:**

- **PostgreSQL**: routes, users, client keys, integrations, snapshots, sync logs, entity links, transaction/audit logs, DLQ persist
- **Redis**: session admin (TTL 24h), rate limit distributed, JWT revocation
- **In-memory**: buffer proxy queue trước khi flush xuống PostgreSQL

Migration SQL tự chạy khi gateway khởi động (`migrations/`).

---

## 4. Backend — những gì đã implement

### 4.1 Gateway Core (~65%)

- **Dynamic Routing Engine**: longest-prefix match, path parameter `{id}`, HTTP method filter, request header transform, per-route timeout, runtime reload
- **Reverse Proxy**: strip `Authorization` trước upstream, preserve query string, path param substitution
- **Resilience**: retry upstream (status/timeout, exponential backoff), DLQ persist PostgreSQL, replay idempotent (`pending` → `replayed` / `failed_permanent`), background replay worker
- **Graceful shutdown**: SIGTERM + Ctrl+C

### 4.2 OAuth2 Identity & Token Lifecycle (~60%)

- **Token endpoint** (`POST /api/oauth/token`): `client_credentials`, `password`, `authorization_code` + **PKCE S256**
- **JWT data plane**: HS256 claims (`sub`, `tenant_id`, `client_key_id`, `jti`, `tv`, `exp`); secret chỉ dùng tại token endpoint
- **Token lifecycle**: revoke per-`jti` (Redis), revoke toàn client (`token_version`), audit, rate limit token endpoint
- **Authorization Code + PKCE** (mở rộng): third-party apps, consent flow, demo callback — *giới hạn: user phải login dashboard trước; không phải full OAuth IdP production*

### 4.3 Security & Access Control (~55%)

- Mật khẩu admin: **Argon2id**; client secret: **Argon2id** one-way; integration config: **AES-256-GCM**; client key tạo UI: **RSA envelope**
- **RBAC 3 role** enforcement backend: `admin` / `operator` / `viewer`
- **Multi-tenant isolation**, ACL whitelist (`gateway_client_key_routes`), admin API key, password reset OTP (Brevo/SMTP)

### 4.4 Rate Limiting (~50%)

- **Token bucket hybrid**: Redis Lua (`gw:rl:*`) + fallback in-memory
- Ưu tiên: Client req/phút → Route req/phút → Global RPS + burst; HTTP 429 + `Retry-After`

### 4.5 Observability (~40%)

- Transaction log async (data plane), audit log (admin plane)
- `/health` (PostgreSQL + Redis latency), `/metrics` JSON + Prometheus
- Grafana dashboard: `deploy/observability/`

### 4.6 Admin API

**Public:** login, logout, register viewer, forgot/reset password, OAuth token, SF/Zoho OAuth callback, RSA public key, feature flags (`/api/ping`).

**Protected (session + RBAC):** CRUD routes, client keys (tạo/rotate/revoke), users, workspace memberships, audit/transaction logs, proxy queue (DLQ), integrations (connect/test/snapshot/sync), OAuth admin, settings, dashboard stats, reload config.

---

## 5. Frontend — Dashboard React SPA

| Trang | Path | Quyền | Chức năng |
|-------|------|-------|-----------|
| Tổng quan | `/` | Tất cả (guest có OverviewGuest) | Stats, middleware pipeline banner |
| Routes | `/routes` | viewer+ | CRUD route, ACL, retry config |
| OAuth & Clients | `/auth` | operator+ | Client registry, tokens, third-party apps, PKCE demo |
| Proxy Try | `/proxy-try` | admin | Thử gọi data plane với JWT |
| Proxy Queue | `/proxy-queue` | operator+ | Xem/replay DLQ |
| API Docs | `/api-docs` | Public | Tài liệu API |
| Integrations | `/integrations` | admin | SF/Zoho connect, pipeline, snapshots, sync logs |
| Users | `/users` | admin | CRUD user, RBAC |
| Logs | `/logs` | admin | Audit + transaction logs |
| Settings | `/settings` | admin | Runtime settings, feature toggles |
| Profile | `/profile` | Đăng nhập | Hồ sơ cá nhân |
| Login / Register / Forgot | `/login`, `/register`, `/forgot-password` | Public | Auth flow |

**Integration UI** (refactor 30/6): ConnectorCard, StatusStrip, PipelinePanel, Snapshots, SyncLogs, EntityLinks.

**UI chính:** MainLayout, Sidebar, WorkspaceSwitcher, WorkspaceMembersPanel, ClientRegistryTable, RoutesTable, shadcn/Radix UI kit.

---

## 6. Tích hợp Salesforce ↔ Zoho (~25%)

### Salesforce Connector

- OAuth2 + PKCE connect, snapshot Opportunity/Account
- Proxy data plane: `GET /v1/api/sf/*`, refresh token tự động
- Config provider (client_id/secret) lưu DB mã hóa AES

### Zoho Projects Connector

- OAuth connect, list portals/projects/tasks
- Proxy: `GET /v1/api/zoho/*`, push Project + Task từ deal Closed Won

### Pipeline SF → Zoho

1. Snapshot SF qua gateway loopback (`/v1/api/sf/*`)
2. Lọc Stage = Closed Won + Amount ≥ ngưỡng (`INTEGRATION_MIN_DEAL_AMOUNT`)
3. Push Zoho Project/Task
4. Ghi `sync_logs` + `integration_entity_links` (idempotent — không tạo trùng)

Background worker: interval 15 phút hoặc `POST /api/integrations/sync-now`. Sync worker **self-dogfood** qua gateway loopback.

**Refactor 30/6:** Xóa Zoho Office, bridge config, opportunity templates → pipeline core đơn giản hơn. Script reset: [`scripts/reset_integration_data.sql`](scripts/reset_integration_data.sql).

---

## 7. Multi-tenant / Workspace

- Bảng `tenants` + `tenant_memberships`
- Workspace switcher UI, invite/remove members
- Route path unique per `(tenant_id, path)`
- Deployment mode: `on_prem` (mặc định) | `saas`
- Viewer registration tùy chọn (`ALLOW_VIEWER_REGISTRATION`)

---

## 8. Deploy & Operations

| Thành phần | Mô tả |
|------------|-------|
| **Docker** | `docker-compose.yml` (dev), `docker-compose.ha.yml` (2 instances + Nginx LB), `docker-compose.observability.yml` |
| **Production** | systemd (`deploy/systemd/`), Nginx TLS `thientinh.io.vn`, tuning VPS 2GB |
| **Scripts** | `smoke-test.sh`, `deploy-production.sh`, `reset_integration_data.sql`, `run-benchmark-suite.sh`, `collect-thesis-evidence.sh` |
| **CI** | `.github/workflows/ci.yml` — `cargo test` + build + `npm test` + build |

### Cài đặt nhanh

```bash
# PostgreSQL + Redis
docker compose up -d postgres redis
cp .env.example .env
cargo run

# Frontend (terminal khác)
cd web && npm install && npm run dev
# Production: npm run build → web/dist/
```

```bash
# Docker all-in-one
docker compose up --build
```

Chi tiết: [`docs/TRIEN_KHAI.md`](docs/TRIEN_KHAI.md), [`docs/TRIEN_KHAI_DOCKER.md`](docs/TRIEN_KHAI_DOCKER.md).

### Kiểm thử

```bash
cargo test
cd web && npm test && npm run build
./scripts/smoke-test.sh
python3 scripts/test_jwt_auth.py
./scripts/collect-thesis-evidence.sh
```

---

## 9. Benchmark & thử nghiệm

VPS DigitalOcean 2 vCPU / 2GB RAM (24/6/2026), tool k6 + wrk:

| Scenario | RPS | p50 (ms) | p95 (ms) |
|----------|-----|----------|----------|
| Upstream direct (mock) | 647 | 3.5 | 8.5 |
| `/health` (không auth) | 2248 | 19.4 | 37.3 |
| JWT full pipeline | 275 | 143.2 | 780.1 |

**Gateway overhead (p50):** ~139.7 ms (JWT pipeline − upstream direct @ 50 VUs).

Chi tiết: [`docs/BENCHMARK.md`](docs/BENCHMARK.md), [`k6/results/BENCHMARK_TABLE.md`](k6/results/BENCHMARK_TABLE.md).

---

## 10. Tài liệu đồ án

| Tài liệu | Nội dung |
|----------|----------|
| [`docs/TONG_QUAN_DO_AN_VA_DANH_GIA.md`](docs/TONG_QUAN_DO_AN_VA_DANH_GIA.md) | Tổng quan + đánh giá đồ án |
| [`docs/MA_TRAN_DO_AN.md`](docs/MA_TRAN_DO_AN.md) | Ma trận chức năng + FR mapping |
| [`docs/THESIS_CONTEXT.md`](docs/THESIS_CONTEXT.md) | Context đồ án cho hội đồng / AI |
| [`docs/CHUONG_4_THU_NGHIEM.md`](docs/CHUONG_4_THU_NGHIEM.md) | Chương thử nghiệm (12/12 TC đạt) |
| [`docs/ROUTING_JWT_CORE.md`](docs/ROUTING_JWT_CORE.md) | Routing + JWT core |
| [`docs/OAUTH2_IDENTITY.md`](docs/OAUTH2_IDENTITY.md) | OAuth2 token endpoint |
| [`docs/RBAC_LVTN.md`](docs/RBAC_LVTN.md) | RBAC |
| [`docs/TICH_HOP_SALESFORCE.md`](docs/TICH_HOP_SALESFORCE.md) | Tích hợp Salesforce |
| [`docs/schema_full_postgresql.sql`](docs/schema_full_postgresql.sql) | Schema DB đầy đủ |
| [`docs/README.md`](docs/README.md) | Mục lục tài liệu đầy đủ |

---

## 11. Những gì CHƯA làm

| Tính năng | Trạng thái |
|-----------|------------|
| Circuit breaker | Chưa implement |
| Sliding window rate limit | Chưa (chỉ token bucket) |
| Kafka/NATS DLQ scale-out | Chưa (chỉ PostgreSQL persist) |
| Full OAuth IdP đa tenant production-grade | Chưa (có PKCE demo, giới hạn) |
| NFR latency ≤10ms gateway overhead @ 50 VUs | Chưa đạt (p50 ~140ms) |
| Distributed tracing (OpenTelemetry/Jaeger) | Chưa |

---

## Cấu trúc thư mục

```
avaso-gateway/
├── src/                 # Backend Rust
├── web/                 # Frontend React (build → web/dist/)
├── migrations/          # SQL migration PostgreSQL
├── scripts/             # Smoke test, benchmark, export DB, ...
├── deploy/              # systemd, nginx, observability
├── docs/                # Báo cáo, runbook, schema
├── k6/                  # Benchmark scripts
├── config.yaml          # Seed routes & toggles
├── docker-compose.yml
└── .env.example
```

---

## License

MIT — see [LICENSE](LICENSE).
