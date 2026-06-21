# Ma trận đồ án — API Gateway (Rust)

**Tỷ trọng bảo vệ:** 35% Routing · 35% JWT Identity · 20% Benchmark · 10% Upstream demo (SF/Zoho)

| Tỷ trọng | # | Chức năng lớn | FR | Trạng thái | Chứng minh |
|----------|---|---------------|-----|------------|------------|
| **35%** | 1 | Routing engine + proxy | FR-B1–B4, A1, A4 | ✅ | `route_match.rs`, `do_proxy` |
| **35%** | 2 | JWT OAuth2 identity | FR-F1–F3 | ✅ | `identity.rs`, `jwt_auth.rs`, `/oauth/token` |
| **35%** | 3 | Rate limiting | FR-F4, F5 | ✅ | Token bucket, 429 |
| **35%** | 4 | Transaction log | FR-D1–D3 | ✅ | `gateway_transaction_logs` |
| **35%** | 5 | Session + RBAC admin | FR-F6, F7 | ✅ | `session.rs`, `admin_auth.rs` |
| **35%** | 6 | OAuth client registry + ACL | FR-G2 | ✅ | Clients UI, `gateway_client_keys` |
| **35%** | 7 | Dashboard SPA | FR-G4 | ✅ | Routes, Proxy Try, Logs, ApiDocs |
| **35%** | 8 | Monitoring `/metrics` | FR-D4 | ✅ | `metrics.rs` |
| **20%** | 9 | **Benchmark NFR** | NFR perf | ✅ | `benchmark-gateway.sh`, `wrk-jwt.lua` |
| **10%** | 10 | Upstream SF/Zoho route | FR-E1–E3 | ✅ | `/v1/api/sf/*`, `/v1/api/zoho/*` |
| **35%** | 11 | Deploy Docker / VPS | FR-C3 | ✅ | `docker-compose.yml`, `deploy/` |

## FR chi tiết — Gateway (core)

| FR | Mô tả ngắn | Status |
|----|------------|--------|
| FR-A1 | HTTP server Axum :3000 | ✅ |
| FR-A3 | /health DB+Redis | ✅ |
| FR-A4 | Upstream timeout → 504 | ✅ |
| FR-B1–B4 | Route CRUD, match, proxy, `{id}` | ✅ |
| FR-B5 | Header transform | ✅ |
| FR-D1–D3 | Transaction log async | ✅ |
| FR-D4 | Prometheus /metrics | ✅ |
| FR-F1–F3 | OAuth2 JWT validate, ACL | ✅ |
| FR-F4–F8 | Rate limit, RBAC, audit | ✅ |
| FR-G1–G4 | Admin CRUD + SPA | ✅ |

## Lệnh demo (thứ tự bảo vệ)

```bash
# 1. Health
curl -sS http://127.0.0.1:3000/health

# 2. JWT auth
python3 scripts/test_jwt_auth.py

# 3. Routing (Proxy Try UI hoặc curl Bearer)

# 4. Benchmark
source ./scripts/ensure-bench-credentials.sh
export BENCH_URL=http://127.0.0.1:3000/health && ./scripts/benchmark-gateway.sh
export BENCH_URL=http://127.0.0.1:3000/v1/api/get && ./scripts/benchmark-gateway.sh

# 5. Evidence bundle
./scripts/collect-thesis-evidence.sh
```

Tài liệu trọng tâm: [`ROUTING_JWT_CORE.md`](ROUTING_JWT_CORE.md), [`BENCHMARK.md`](BENCHMARK.md)
