# Ma trận đồ án — Gateway Platform + Connector extension

**Tỷ trọng bảo vệ:** 70% Gateway · 20% SF Connector · 10% Zoho sync demo

| Tỷ trọng | # | Chức năng lớn | FR | Trạng thái | Chứng minh |
|----------|---|---------------|-----|------------|------------|
| **70%** | 1 | API Gateway + Proxy | FR-A1, A3, A4 | ✅ | `main.rs` `do_proxy`, `/health` |
| **70%** | 2 | Routing động | FR-B1–B4 | ✅ | `route_match.rs`, `{id}` |
| **70%** | 3 | HMAC auth + replay | FR-F1–F3 | ✅ | `verify_client_auth`, `test_hmac_replay.py` |
| **70%** | 4 | Rate limiting | FR-F4, F5 | ✅ | Token bucket, 429 |
| **70%** | 5 | Pipeline T/R/DLQ | FR-B5, H1, H2 | ✅ | `proxy_ext.rs`, DLQ PostgreSQL |
| **70%** | 6 | Transaction log | FR-D1–D3 | ✅ | `gateway_transaction_logs` |
| **70%** | 7 | Audit log | FR-F8 | ✅ | `audit_logs` |
| **70%** | 8 | Session + RBAC admin | FR-F6, F7 | ✅ | `session.rs`, `admin_auth.rs` |
| **70%** | 9 | Client API key + ACL | FR-G2 | ✅ | Clients UI, `crypto.rs` |
| **70%** | 10 | Dashboard SPA (gateway UI) | FR-G4 | ✅ | Routes, Clients, Proxy Try, Logs |
| **70%** | 11 | Monitoring `/metrics` | FR-D4, E1, E2 | ✅ | `metrics.rs` |
| **20%** | 12 | **Salesforce Connector** | FR-E1 | ✅ | OAuth, `/v1/api/sf/*` |
| **10%** | 13 | **Zoho Projects Connector** | FR-E2 | ✅ | OAuth, `/v1/api/zoho/*` |
| **10%** | 14 | Sync demo SF→Zoho | FR-E3–E5 | ✅ | `run_full_sync_pipeline`, entity_links |
| **70%** | 15 | Deploy Docker / VPS | FR-C3 | ✅ | `docker-compose.yml`, `deploy/` |

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
| FR-F1–F8 | HMAC, rate limit, RBAC, audit | ✅ |
| FR-G1–G4 | Admin CRUD + SPA | ✅ |
| FR-H1–H2 | Retry + DLQ PostgreSQL | ✅ |

## FR extension — Connector

| FR | Mô tả ngắn | Status |
|----|------------|--------|
| FR-E1 | Salesforce OAuth + snapshot + proxy | ✅ |
| FR-E2 | Zoho Projects OAuth + proxy | ✅ |
| FR-E3 | Data plane `/v1/api/sf|zoho/*` qua HMAC | ✅ |
| FR-E4 | Sync pipeline Closed Won → Project | ✅ |
| FR-E5 | Entity link idempotency | ✅ |

## Lệnh demo (thứ tự bảo vệ)

```bash
# Demo 1–3: Gateway core
curl -sS https://thientinh.io.vn/health
./scripts/smoke-test.sh
python3 scripts/test_hmac_replay.py

# Demo 4: Extension
./scripts/test-integrations.sh
./scripts/collect-thesis-evidence.sh
```
