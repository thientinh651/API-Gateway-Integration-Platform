# Ma trận đồ án — FR ↔ chức năng lớn ↔ code

15 **chức năng lớn** (phân hệ), 32 **FR** chi tiết (từ SRS). Một chức năng lớn gồm nhiều FR.

| # | Chức năng lớn | FR | Trạng thái | Chứng minh |
|---|---------------|-----|------------|------------|
| 1 | API Gateway + Proxy | FR-A1, A3, A4 | ✅ | `main.rs` `do_proxy`, `/health` |
| 2 | Routing động | FR-B1–B4 | ✅ | `route_match.rs`, `allowed_methods`, `{id}` |
| 3 | HMAC auth + replay | FR-F1–F3 | ✅ | `verify_client_auth`, `test_hmac_replay.py` |
| 4 | Rate limiting | FR-F4, F5 | ✅ | `TokenBucket` + `Retry-After` 429 |
| 5 | Pipeline T/R/DLQ | FR-B5, H1, H2 | ✅ | `proxy_ext.rs`, DLQ PostgreSQL |
| 6 | Transaction log | FR-D1–D3 | ✅ | `gateway_transaction_logs`, spawn async |
| 7 | Audit log | FR-F8 | ✅ | `audit_logs` |
| 8 | Session admin | FR-F6 | ✅ | `session.rs` |
| 9 | RBAC | FR-F7 | ✅ | `admin_auth.rs`, `rbac.ts` |
| 10 | Identity (user/OTP/register) | FR-G3 + mở rộng | ✅ | `ForgotPassword`, `Register` |
| 11 | Client API key | FR-G2 | ✅ | `api_*_client_key`, `crypto.rs` |
| 12 | Salesforce | F-13 (mở rộng) | ✅ | `integrations.rs` SF |
| 13 | Zoho Projects | F-14 (mở rộng) | ✅ | `integrations.rs` Zoho |
| 14 | Dashboard SPA | FR-G4 | ✅ | `web/src/app/` |
| 15 | Deploy / HA / Docker | FR-C3 + DevOps | ✅ | `deploy/`, `docker-compose.ha.yml` |

## FR chi tiết — trạng thái

| FR | Mô tả ngắn | Status | Ghi chú |
|----|------------|--------|---------|
| FR-A1 | HTTP server | ✅ | Axum :3000 |
| FR-A2 | HTTP/2 | ⚠️ | TLS qua Nginx, không native Axum |
| FR-A3 | /health | ✅ | DB + Redis check |
| FR-A4 | Upstream timeout → 504 | ✅ | `proxy_ext.rs` |
| FR-B1 | Cấu hình route | ✅ | PostgreSQL (+ seed YAML) |
| FR-B2 | Route matching | ✅ | Prefix + longest + method filter |
| FR-B3 | Proxy forward | ✅ | reqwest |
| FR-B4 | Path `{id}` | ✅ | `route_match.rs` |
| FR-B5 | Header transform | ✅ | Toggle settings |
| FR-C1 | Graceful shutdown | ✅ | SIGTERM + Ctrl+C `with_graceful_shutdown` |
| FR-C2 | Hot reload SIGHUP | ❌ | Dùng `reload_runtime_config` API |
| FR-C3 | Binary release | ✅ | `cargo build --release` |
| FR-D1–D3 | Transaction log JSON | ✅ | Async INSERT |
| FR-D4 | Prometheus /metrics | ✅ | JSON + `?format=prometheus` |
| FR-E1 | Traffic counters | ✅ | `metrics.rs` |
| FR-E2 | Latency histogram | ✅ | `record_latency`, Prometheus buckets |
| FR-F1–F8 | Security + RBAC + audit | ✅ | HMAC not plain key only |
| FR-G1–G4 | Admin CRUD + UI | ✅ | |
| FR-H1–H2 | Retry + DLQ | ✅ | PostgreSQL `gateway_proxy_queue` |

## Lệnh demo nhanh (bảo vệ)

```bash
curl -sS https://thientinh.io.vn/health
./scripts/smoke-test.sh
python3 scripts/test_hmac_replay.py   # cần client key
./scripts/collect-thesis-evidence.sh
```
