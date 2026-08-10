# Routing Engine + JWT Middleware (trọng tâm bảo vệ)

## 1. Routing Engine

**Code:** `src/route_match.rs`, `src/main.rs` (`handle_data_plane_request`, `do_proxy`)

Pipeline mỗi request `/v1/api/*`:

```
HTTP Request
  → JWT validate (jwt_auth.rs)
  → Rate limit (token bucket: rate = RPM/60, burst = min(RPM, trần Settings))
  → Route match (longest prefix, {param})
  → ACL client ↔ route
  → Transform headers (optional)
  → Proxy upstream (reqwest async)
  → Log transaction
  → Response về client
```

| Tính năng | Mô tả |
|-----------|--------|
| Prefix match | `/v1/api/products` → target URL |
| Longest win | Nhiều route overlap — path dài hơn thắng |
| `{id}` param | `/v1/api/users/{id}` substitute upstream |
| Method filter | `allowed_methods` per route |
| Tenant isolation | Client chỉ route cùng `tenant_id` |

**Demo bảo vệ:** Dashboard → Routes → tạo route → Proxy Try gọi path.

## 2. JWT Validation Middleware

**Code:** `src/identity.rs`, `src/jwt_auth.rs`

| Bước | Endpoint / header |
|------|-------------------|
| Phát token | `POST /oauth/token` |
| Gọi API | `Authorization: Bearer eyJ...` |
| Validate | HS256, `iss`, `exp`, client ACL |

Grants:
- `client_credentials` — web shop, script benchmark
- `password` — user demo (dashboard_users)

Claims chính: `sub`, `tenant_id`, `token_type`, `client_key_id`, `exp`.

**Demo bảo vệ:**
1. Không Bearer → `401 missing_token`
2. Token hợp lệ → `200` hoặc upstream status
3. Token hết hạn → `401 token_expired`

## 3. Benchmark (NFR)

**Script:** `./scripts/benchmark-gateway.sh`

```bash
# Baseline — không auth
export BENCH_URL="http://127.0.0.1:3000/health"
./scripts/benchmark-gateway.sh

# JWT + routing
source ./scripts/ensure-bench-credentials.sh
export BENCH_URL="http://127.0.0.1:3000/v1/api/get"
./scripts/benchmark-gateway.sh
```

So sánh slide bảo vệ:

| Scenario | req/s | p99 | Ghi chú |
|----------|-------|-----|---------|
| Direct backend | X | Y ms | httpbin / mock API |
| Gateway /health | X' | Y' ms | overhead tối thiểu |
| Gateway + JWT + route | X'' | Y'' ms | full pipeline |

Kết luận mẫu: *Gateway thêm JWT + routing, overhead ~10–15% nhờ Rust/Tokio.*

Chi tiết: [`BENCHMARK.md`](BENCHMARK.md)

## Tỷ trọng nói bảo vệ

| Phần | % thời gian |
|------|-------------|
| Routing engine | 35% |
| JWT identity | 35% |
| Benchmark | 20% |
| Integration upstream (SF/Zoho) | 10% |
