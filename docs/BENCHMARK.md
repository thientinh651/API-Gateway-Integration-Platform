# Benchmark — Gateway NFR

Chứng minh AVASO Gateway duy trì throughput cao khi bật JWT validation + routing.

## Chuẩn bị

```bash
docker compose up -d postgres redis
cargo run   # hoặc systemd production

source ./scripts/ensure-bench-credentials.sh
# → BENCH_API_KEY, BENCH_SECRET_KEY, BENCH_ACCESS_TOKEN
```

Cài `wrk` (khuyến nghị) hoặc **k6 trên laptop Windows** (xem [`k6/README.md`](../k6/README.md)):

```bash
sudo apt install wrk   # Ubuntu
```

## Kịch bản 1 — Baseline (không auth)

Đo overhead tối thiểu của Axum server:

```bash
export BENCH_URL="http://127.0.0.1:3000/health"
export BENCH_DURATION=30s
export BENCH_CONCURRENCY=50
./scripts/benchmark-gateway.sh
```

## Kịch bản 2 — JWT + Routing (full pipeline)

Cần route `/v1/api/get` (hoặc path đã cấu hình) + OAuth client:

```bash
source ./scripts/ensure-bench-credentials.sh
export BENCH_URL="http://127.0.0.1:3000/v1/api/get"
export BENCH_DURATION=30s
export BENCH_CONCURRENCY=50
./scripts/benchmark-gateway.sh
```

Script tự:
1. Gọi `POST /oauth/token` (client_credentials)
2. wrk với `Authorization: Bearer` (`scripts/wrk-jwt.lua`)
3. Ghi RSS trước/sau, metrics snapshot

Output: `data/benchmark/result-YYYYMMDD-HHMMSS.txt`

## Kịch bản 3 — So sánh direct vs gateway (slide)

1. Chạy wrk thẳng upstream mock (vd httpbin `:80/get`)
2. Chạy wrk qua gateway cùng path route
3. Tính overhead % = `(RPS_direct - RPS_gateway) / RPS_direct`

## JWT auth smoke

```bash
python3 scripts/test_jwt_auth.py
```

## Biến môi trường

| Biến | Mô tả |
|------|--------|
| `BENCH_URL` | URL benchmark |
| `BENCH_API_KEY` | OAuth client_id |
| `BENCH_SECRET_KEY` | OAuth client_secret |
| `BENCH_ACCESS_TOKEN` | JWT (optional, auto-fetch) |
| `BENCH_DURATION` | wrk duration (default 10s) |
| `BENCH_CONCURRENCY` | wrk connections |
