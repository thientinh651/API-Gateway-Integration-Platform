# Bảng kết quả benchmark — điền sau mỗi lần chạy

**Môi trường:** DigitalOcean 2 vCPU / 2GB RAM · Singapore  
**Tool:** wrk (VPS localhost) hoặc k6 (laptop → HTTPS)  
**Ngày:** 2026-06-24

> Trước khi bench: **tắt rate limit** global (`rate_limit_enabled=false`).  
> Route bench: `/v1/api/bench/get` → mock local `127.0.0.1:8089` (không dùng httpbin).  
> Chạy suite: `./scripts/run-benchmark-suite.sh`

---

## Bảng tổng hợp @ 50 VUs / 30s (localhost VPS)

| Scenario | RPS | p50 (ms) | p95 (ms) | p99 (ms) | Error / ghi chú |
|----------|-----|----------|----------|----------|-----------------|
| **A — upstream_direct** (`8089/get`) | 647 | 3.5 | 8.5 | 421 | Mock Python read errors @ high load |
| **B — health** (`/health`) | 2248 | 19.4 | 37.3 | 56.7 | Không auth, không proxy |
| **C — jwt_full_pipeline** (`/v1/api/bench/get`) | 275 | 143.2 | 780.1 | 1240 | JWT + ACL + proxy mock |

**Gateway overhead (p50):** 143.2 − 3.5 ≈ **139.7 ms** (jwt pipeline − upstream direct)

**NFR latency ≤10 ms gateway overhead:** **Chưa đạt** trên pipeline đầy đủ @ 50 VUs — cần ghi rõ trong báo cáo hoặc bench @ VUs thấp hơn (10–20) để đo overhead tối thiểu.

---

## Benchmark A — `GET /health` (không auth)

Mục tiêu: overhead tối thiểu gateway (routing/core).

```bash
wrk -t50 -c50 -d30s --latency http://127.0.0.1:3000/health
# hoặc
k6 run -e BASE_URL=https://thientinh.io.vn -e SCENARIO=health -e VUS=50 -e DURATION=30s k6/benchmark.js
```

| VUs | RPS | p50 (ms) | p95 (ms) | Error % | CPU | RAM (MB) |
|-----|-----|----------|----------|---------|-----|----------|
| 50 (local) | 2248 | 19.4 | 37.3 | 0 | | 2148 RSS KB |
| 50 (remote k6) | 877 | 56.5 | 106.8 | 0 | | |

---

## Benchmark B — JWT full pipeline

Mục tiêu: JWT + ACL + rate limit check + proxy upstream mock.

```bash
source ./scripts/ensure-bench-credentials.sh
export BENCH_JWT_PATH=/v1/api/bench/get BENCH_ACCESS_TOKEN
wrk -t50 -c50 -d30s --latency -s scripts/wrk-jwt.lua http://127.0.0.1:3000/v1/api/bench/get
```

| VUs | RPS | p50 (ms) | p95 (ms) | Error % | CPU | RAM (MB) |
|-----|-----|----------|----------|---------|-----|----------|
| 50 (local) | 275 | 143.2 | 780.1 | timeout 43 | | |

---

## Benchmark C — Gateway vs upstream trực tiếp

| Test | VUs | RPS | p50 (ms) | Overhead p50 |
|------|-----|-----|----------|--------------|
| Mock upstream direct (`8089`) | 50 | 647 | 3.5 | — |
| Gateway + JWT (`/v1/api/bench/get`) | 50 | 275 | 143.2 | **+139.7 ms** |

Mock: `python3 scripts/mock-upstream.py` (port 8089). Production bench nên thay bằng nginx static JSON nếu mock Python báo socket read errors.

---

## SSH — lấy CPU/RAM (Droplet)

```bash
pgrep -a avaso-gateway
ps -o pid,rss,cmd -p $(pgrep avaso-gateway)
free -m
```

---

## Kết luận mẫu (slide)

- Benchmark A: `/health` local **~2248 req/s** @ 50 VUs; remote qua TLS **~877 req/s**.
- Benchmark B/C: full JWT pipeline **~275 req/s** @ 50 VUs; overhead p50 **~140 ms** so với mock upstream.
- NFR ≥500 req/s: **đạt** trên `/health`; **chưa đạt** trên full JWT @ 50 VUs — trình bày trung thực, phân tách scenario.
- Hướng cải thiện: tắt transaction log bench route, nginx mock, connection pool tuning.
