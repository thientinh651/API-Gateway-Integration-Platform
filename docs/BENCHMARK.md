# Benchmark & chứng cứ NFR (đồ án)

**Mục đích:** Số liệu latency + RSS — **không** so sánh thay WSO2.

## Chạy nhanh

```bash
# Health (không cần API key)
./scripts/benchmark-gateway.sh

# Data-plane (HMAC)
export BENCH_URL="http://127.0.0.1:3000/v1/api/get"
export BENCH_API_KEY="avaso_pk_..."
export BENCH_SECRET_KEY="avaso_sk_..."
./scripts/benchmark-gateway.sh
```

Kết quả: `data/benchmark/result-<timestamp>.txt`

## Soak RAM 24h (NFR-20)

```bash
export SOAK_API_KEY="avaso_..."
SOAK_HOURS=1 ./scripts/nfr20-soak-test.sh
# → data/soak-nfr20/memory-*.csv
```

RSS không tăng tuyến tính → pass ổn định bộ nhớ (Rust).

## Gom tất cả cho báo cáo

```bash
./scripts/collect-thesis-evidence.sh
```

## Metrics runtime

```bash
curl -sS http://127.0.0.1:3000/metrics | python3 -m json.tool
```

| Field | Ý nghĩa |
|-------|---------|
| `uptime_secs` | Thời gian process chạy |
| `data_plane.requests_total` | Số request data-plane đã log |
| `data_plane.denied_total` | 401/403… |
| `data_plane.success_total` | Forward thành công |

## Ghi vào slide (mẫu)

| Metric | Giá trị (điền sau khi chạy) |
|--------|-----------------------------|
| RSS gateway (KB) | từ `benchmark` hoặc `ps` |
| Avg latency `/health` (ms) | từ `benchmark` |
| Soak 1h RSS max−min | từ CSV |

## Công cụ tuỳ chọn

```bash
sudo apt install hey   # histogram RPS
hey -n 500 -c 20 http://127.0.0.1:3000/health
```
