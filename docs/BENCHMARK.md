# Benchmark & NFR — cách đo và chứng minh

## NFR trong luận văn (mục tiêu)

| NFR | Mục tiêu đề ra | Cách đo | Ghi chú thực tế |
|-----|----------------|---------|-----------------|
| Throughput | ~5000 req/s | `wrk` / `oha` 30–60s | Cần chạy trên VPS; evidence mẫu 50 req curl loop |
| Latency overhead | ≤10 ms vs upstream | So sánh direct vs qua gateway | Đo trên route proxy thật |
| Concurrent | 1000 keep-alive | `wrk -c 1000` | Droplet 2GB — điều chỉnh kỳ vọng |
| Soak 24h | Lỗi nội bộ <1% | `scripts/nfr20-soak-test.sh` | Xem `deploy/systemd/NFR20_STABILITY.md` |
| Hot reload | <1s | Sửa route UI → gọi API ngay | `reload_runtime_config`, không SIGHUP |

## Script có sẵn

```bash
# Gom chứng cứ (smoke + health + metrics + bench nhỏ)
./scripts/collect-thesis-evidence.sh

# Benchmark health (mặc định 50 req, concurrency 5)
./scripts/benchmark-gateway.sh

# Tuỳ chỉnh
BENCH_REQUESTS=1000 BENCH_CONCURRENCY=50 ./scripts/benchmark-gateway.sh
```

Output: `data/thesis-evidence/YYYYMMDD-HHMMSS/`

## wrk (khuyến nghị slide)

```bash
# Cài wrk trên VPS
sudo apt install -y wrk

# Health (không HMAC)
wrk -t4 -c100 -d30s http://127.0.0.1:3000/health

# Data plane cần script ký HMAC — dùng route test + key trong DB
```

## Metrics hiện tại

`GET /metrics` — JSON counters (request count, rate limit hits). **Chưa** Prometheus text format.

## Điền vào bảng TC luận văn

| TC | NFR | Lệnh | Kết quả mong đợi |
|----|-----|------|------------------|
| TC-NFR-01 | Health | `curl /health` | 200, JSON ok |
| TC-NFR-02 | Smoke | `./scripts/smoke-test.sh` | login OK |
| TC-NFR-03 | Bench | `collect-thesis-evidence.sh` | 0 fail, RSS ổn |
| TC-NFR-04 | Unit | `cargo test` | pass |

Chèn screenshot + file log từ `data/thesis-evidence/` vào Chương 4.
