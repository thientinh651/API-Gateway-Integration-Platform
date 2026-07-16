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




**Demo production:** [https://thientinh.io.vn](https://thientinh.io.vn)

**Script Database:** [docs/schema_full_postgresql.sql](docs/schema_full_postgresql.sql)

**Báo cáo LVTN:** [Báo cáo/Báo cáo LVTN.docx](Báo%20cáo/Báo%20cáo%20LVTN.docx)



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


---

## Kiến trúc hệ thống

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

---

## Frontend — Dashboard React SPA

| Trang | Path | Quyền | Chức năng |
|-------|------|-------|-----------|
| Tổng quan | `/` | Tất cả (guest có OverviewGuest) | Stats, middleware pipeline banner |
| Routes | `/routes` | viewer+ | CRUD route, ACL, retry config |
| OAuth & Clients | `/auth` | operator+ | Client registry, tokens, third-party apps, PKCE demo |
| Proxy Try | `/proxy-try` | admin | Thử gọi data plane với JWT |
| Proxy Queue | `/proxy-queue` | operator+ | Xem/replay DLQ |
| Tài liệu API | `/api-docs` | Public | Hướng dẫn + catalog endpoint (tabs) |
| Integrations | `/integrations` | admin | SF/Zoho connect, pipeline, snapshots, sync logs |
| Users | `/users` | admin | CRUD user, RBAC |
| Logs | `/logs` | admin | Audit + transaction logs |
| Settings | `/settings` | admin | Runtime settings, feature toggles |
| Profile | `/profile` | Đăng nhập | Hồ sơ cá nhân |
| Login / Register / Forgot | `/login`, `/register`, `/forgot-password` | Public | Auth flow |

**Integration UI** (refactor 30/6): ConnectorCard, StatusStrip, PipelinePanel, Snapshots, SyncLogs, EntityLinks.

**UI chính:** MainLayout, Sidebar, WorkspaceSwitcher, WorkspaceMembersPanel, ClientRegistryTable, RoutesTable, shadcn/Radix UI kit.

---

---
## Deploy & Operations

| Thành phần | Mô tả |
|------------|-------|
| **Docker** | `docker-compose.yml` (dev), `docker-compose.ha.yml` (2 instances + Nginx LB), `docker-compose.observability.yml` |
| **Production** | systemd (`deploy/systemd/`), Nginx TLS `thientinh.io.vn`, tuning VPS 2GB |
| **Scripts** | `smoke-test.sh`, `deploy-production.sh`, `reset_integration_data.sql`, `run-benchmark-suite.sh`, `collect-thesis-evidence.sh` |
| **CI** | `.github/workflows/ci.yml` — `cargo test` + build + `npm test` + build |


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

## Benchmark & thử nghiệm

VPS DigitalOcean 2 vCPU / 2GB RAM (24/6/2026), tool k6 + wrk:

| Scenario | RPS | p50 (ms) | p95 (ms) |
|----------|-----|----------|----------|
| Upstream direct (mock) | 647 | 3.5 | 8.5 |
| `/health` (không auth) | 2248 | 19.4 | 37.3 |
| JWT full pipeline | 275 | 143.2 | 780.1 |

**Gateway overhead (p50):** ~139.7 ms (JWT pipeline − upstream direct @ 50 VUs).

Chi tiết: [`docs/BENCHMARK.md`](docs/BENCHMARK.md), [`k6/results/BENCHMARK_TABLE.md`](k6/results/BENCHMARK_TABLE.md).

---


---

## License

MIT — see [LICENSE](LICENSE).
