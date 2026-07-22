# Ma trận chức năng — AVASO Gateway Platform

**Định vị:** Nền tảng API Gateway hiệu năng cao (Rust) với khả năng mở rộng tích hợp (Integration Connectors).  
**Tỷ trọng bảo vệ:** ~70% Gateway Core · ~20% Salesforce Connector · ~10% Zoho sync pipeline  
**Production:** https://thientinh.io.vn

---

## 1. Ma trận chức năng chính

| Tỷ trọng | # | Chức năng lớn | FR | TT | Chứng minh / Đóng góp kỹ thuật |
|----------|---|---------------|-----|-----|--------------------------------|
| **65%** | 1 | **High-performance API Gateway Core** | FR-A1–A5 | ✅ | `main.rs`: Axum router, data/admin plane tách biệt, SQLx pool, reqwest shared client, graceful shutdown (SIGTERM/Ctrl+C) |
| **65%** | 2 | **Dynamic Routing Engine** | FR-B1–B5 | ✅ | `route_match.rs`: longest-prefix match, path param `{id}`, method filter, header transform; runtime reload không restart binary |
| **60%** | 3 | **OAuth2 Identity & Token Lifecycle** | FR-F1–F4 | ✅ | `identity.rs`, `oauth_handlers.rs`, `oauth_tokens.rs`: Client Credentials + Password grant; Authorization Code + **PKCE S256** (`oauth_authorize.rs`); JWT `jti`/`tv`/revoke Redis |
| **55%** | 4 | **Security & Access Control** | FR-G1–G3 | ✅ | `jwt_auth.rs`: tenant isolation + ACL `gateway_client_key_routes`; `admin_auth.rs`: RBAC 3 role enforcement thật (không chỉ UI) |
| **50%** | 5 | **Rate Limiting & Protection** | FR-F5 | ✅ | `rate_limit.rs`: hybrid token bucket — Redis Lua (`gw:rl:*`) + fallback in-memory; ưu tiên client → route → global RPS; 429 + `Retry-After` |
| **45%** | 6 | **Resilience & Reliability** | FR-H1–H3 | ✅ | `proxy_ext.rs`: configurable retry (status/timeout), DLQ persist PostgreSQL, replay idempotent (`pending`→`replayed`), background replay worker |
| **40%** | 7 | **Observability & Logging** | FR-D1–D4 | ✅ | Async transaction log (`gateway_transaction_logs`), admin audit trail, `metrics.rs` — JSON + Prometheus text (`/metrics?format=prometheus`) |
| **35%** | 8 | **Admin Control Plane + Dashboard** | FR-G4 | ✅ | React/Vite SPA: route/client/log/DLQ/proxy-try; RBAC UX (`rbac.ts`) + session Redis (`gw_sid`) |
| **30%** | 9 | **Client Registry & Secret Management** | FR-F2 | ✅ | `avaso_cid_*` / `avaso_csec_*` (legacy `pk_`/`sk_` OK); secret **Argon2id** at rest; RSA envelope tạo client (`gateway_rsa.rs`); rotate → bump `token_version` |
| **25%** | 10 | **Extensible Integration Framework** | FR-E1–E5 | ✅ | Connector pattern qua data plane JWT proxy; sync worker loopback (`sync_worker_gateway.rs`); SF→Zoho pipeline + entity link idempotent |
| **15%** | 11 | **Deploy & Operations** | FR-C3 | ✅ | systemd + Nginx TLS (`deploy/`), Docker Compose dev/HA, `/health` dependency probe |

---

## 2. Đóng góp kỹ thuật (trả lời hội đồng)

| # | Đóng góp | Khác biệt so với reverse proxy thuần |
|---|----------|--------------------------------------|
| 1 | **Middleware pipeline có chính sách** | Mỗi request data plane: JWT → rate limit → route → ACL → transform → proxy → log — không chỉ forward HTTP |
| 2 | **Token bucket phân tầng + distributed-ready** | Redis + RAM fallback; quota per client/route/global — throttle có refill, không hard-ban |
| 3 | **DLQ persist + replay** | Upstream fail sau retry → PostgreSQL queue; operator replay — reliability pattern thực tế |
| 4 | **Identity tách biệt data plane** | Secret chỉ tại token endpoint; Bearer JWT ngắn hạn + revocation `jti`/`tv` |
| 5 | **Self-dogfood integration** | Sync worker đi qua gateway loopback — mọi call SF/Zoho có transaction log + rate limit |
| 6 | **Rust/Tokio single binary** | Async I/O, overhead thấp — benchmark JWT pipeline (`k6/benchmark.js`, `docs/BENCHMARK.md`) |

**Metric tham chiếu (cần điền số đo thực tế):**

| Kịch bản | Ý nghĩa | Script |
|----------|---------|--------|
| `/health` | Baseline runtime Rust | `k6/benchmark.js` `SCENARIO=health` |
| JWT full pipeline | NFR throughput gateway thật | `SCENARIO=jwt` |
| Upstream direct | Overhead = gateway − direct | `benchmark-direct.js` |

---

## 3. FR chi tiết — Gateway Core

| FR | Mô tả | TT | Ghi chú kỹ thuật |
|----|--------|-----|------------------|
| FR-A1 | HTTP server Axum + Tokio async runtime | ✅ | Single process, multi-task; bind `BIND_HOST`/`PORT` |
| FR-A2 | Graceful shutdown | ✅ | SIGTERM + Ctrl+C → `with_graceful_shutdown` |
| FR-A3 | Health check + dependency validation | ✅ | `/health`: PostgreSQL ping + Redis session store latency; `ok` / `degraded` |
| FR-A4 | Upstream reverse proxy | ✅ | Per-route timeout; strip `Authorization`; query string preserve; path param substitution |
| FR-A5 | Runtime config reload | ✅ | `POST /api/reload-config`; settings PG override YAML bootstrap |
| FR-B1 | Route CRUD (admin plane) | ✅ | PostgreSQL `gateway_routes`; tenant isolation |
| FR-B2 | Longest-prefix route matching | ✅ | `specificity()` — overlap path dài hơn thắng |
| FR-B3 | Parameterized routing `{id}` | ✅ | `match_pattern()` + `build_upstream_url()` |
| FR-B4 | HTTP method filtering | ✅ | `allowed_methods` per route; `*` = all |
| FR-B5 | Request header transformation | ✅ | Add/remove JSON config; toggle runtime global |
| FR-D1 | Transaction log (data plane) | ✅ | Async insert: method, path, status, outcome, `elapsed_ms`, `client_key_id` |
| FR-D2 | Audit log (admin plane) | ✅ | Actor, resource, outcome — mọi thao tác CRUD/denied |
| FR-D3 | Structured logging | ✅ | `tracing` JSON runtime |
| FR-D4 | Metrics exporter | ✅ | Counter outcome + latency histogram; Prometheus-compatible |
| FR-F1 | OAuth2 token endpoint | ✅ | `POST /api/oauth/token`: `client_credentials`, `password`, `authorization_code` |
| FR-F2 | Client registry + secret at rest | ✅ | Argon2id `secret_hash`; plaintext một lần lúc tạo/rotate |
| FR-F3 | JWT issuance & validation | ✅ | HS256 claims: `sub`, `tenant_id`, `client_key_id`, `allowed_route_ids`, `jti`, `tv`, `exp` |
| FR-F4 | Token revocation | ✅ | Per-`jti` Redis blacklist; client-wide via `token_version` bump |
| FR-F5 | Rate limiting token bucket | ✅ | Client/route req/phút; global RPS+burst; OAuth token endpoint riêng (20/min/client) |
| FR-F6 | Admin session management | ✅ | Cookie `gw_sid` Redis; revoke all on password change |
| FR-F7 | RBAC admin (admin/operator/viewer) | ✅ | Per-endpoint `rbac_allow()` — backend enforcement |
| FR-F8 | Authorization Code + PKCE | ✅ | RFC 7636 S256; consent flow; *giới hạn:* user phải login dashboard trước — không phải IdP production đầy đủ |
| FR-G1 | Client ACL whitelist routes | ✅ | Empty ACL = full tenant; else `gateway_client_key_routes` |
| FR-G2 | Multi-tenant isolation | ✅ | `tenant_id` trên route, client, log, integration |
| FR-G3 | Admin API key automation | ✅ | SHA256 hash; optional `ALLOW_ADMIN_API_KEY=1` |
| FR-G4 | Dashboard SPA | ✅ | Overview, Routes, OAuth & Clients, Proxy Try, Queue, Logs, Integrations, Users, Settings |
| FR-H1 | Upstream retry policy | ✅ | `retry_max`, `retry_on_status`, `retry_on_timeout`, exponential backoff |
| FR-H2 | Dead Letter Queue | ✅ | In-memory buffer → `gateway_proxy_queue`; status lifecycle |
| FR-H3 | DLQ replay idempotency | ✅ | Manual UI replay + auto worker; `failed_permanent` sau max attempts |

**Chưa implement (ghi Chương hướng phát triển, không claim):** circuit breaker, sliding window rate limit, Kafka DLQ, full OAuth IdP đa tenant.

---

## 4. FR Extension — Integration & Extensibility

| FR | Mô tả | TT | Ghi chú |
|----|--------|-----|---------|
| FR-E1 | Salesforce Connector | ✅ | OAuth2 PKCE connect; refresh token AES PG; snapshot Opportunity/Account/Contact; proxy `GET /v1/api/sf/*` qua JWT ACL |
| FR-E2 | Zoho Projects Connector | ✅ | OAuth connect; list portals/projects/tasks; proxy `GET /v1/api/zoho/*` |
| FR-E3 | Data plane unified entry | ✅ | Mọi connector traffic qua cùng middleware pipeline — không bypass gateway |
| FR-E4 | Background sync pipeline | ✅ | Middleware filter Closed Won + amount threshold → push Zoho Project/Task; worker 15 phút / Sync Now |
| FR-E5 | Entity linking & idempotency | ✅ | `integration_entity_links` UNIQUE — rerun sync không tạo trùng |

**Ý nghĩa extension:** Chứng minh gateway không chỉ proxy generic upstream — có thể đóng vai **integration hub** khi thêm route + connector module, không sửa core pipeline.

---

## 5. Mapping pipeline ↔ module (tránh đọc như CRUD)

```
Request /v1/api/*
  → jwt_auth.rs          (identity)
  → rate_limit.rs        (protection)
  → route_match.rs       (routing)
  → jwt_auth ACL         (authorization)
  → proxy_ext.rs         (transform + proxy + retry + DLQ)
  → db transaction log   (observability)
```

Admin `/api/*` → `admin_auth.rs` (session + RBAC) → handlers CRUD config.

Integration sync → `sync_worker_gateway.rs` → loopback data plane → `integrations.rs`.

---

## 6. Lệnh chứng minh (thứ tự demo bảo vệ)

```bash
# Core: health + smoke + JWT auth chain
curl -sS https://thientinh.io.vn/health
./scripts/smoke-test.sh
python3 scripts/test_jwt_auth.py

# Performance (điền bảng Chương 4)
source ./scripts/ensure-bench-credentials.sh
SCENARIO=jwt ./scripts/benchmark-gateway.sh

# Extension (~10 phút cuối)
./scripts/test-integrations.sh
./scripts/collect-thesis-evidence.sh
```

---

## 7. Thuật ngữ trình bày (không nhầm)

| Tránh nói | Nên nói |
|-----------|---------|
| "CRUD route/client" | "Cấu hình routing engine / client registry trên control plane" |
| "Có OAuth" | "OAuth2 token endpoint + JWT middleware pipeline + PKCE cho third-party app" |
| "Có rate limit" | "Hybrid token bucket phân tầng, distributed Redis + fallback" |
| "Tích hợp SF-Zoho là sản phẩm" | "Connector extension minh họa extensibility trên data plane" |

**File liên quan:** `docs/THESIS_CONTEXT.md` · `docs/CHUONG_4_THU_NGHIEM.md` · `docs/BAO_CAO_DOAN_THIEU.md` · `docs/BENCHMARK.md`
