# k6 benchmark — Windows / laptop

Chạy **trên ** (Windows), bắn vào Droplet. **Không** cài k6 trên server gateway.

## 1. Cài k6 trên Windows

- Tải `k6-*-windows-amd64.msi` hoặc `.zip` từ [k6 releases](https://github.com/grafana/k6/releases)
- Giải nén → thêm thư mục chứa `k6.exe` vào **PATH**, hoặc mở CMD tại thư mục đó

Kiểm tra:

```cmd
k6 version
```

### Web dashboard (giao diện chart)

**Không có** flag `--web-dashboard`. Dùng **biến môi trường** (Windows CMD):

```cmd
set K6_WEB_DASHBOARD=true
set K6_WEB_DASHBOARD_OPEN=true
k6 run -e BASE_URL=https://thientinh.io.vn -e SCENARIO=health -e VUS=50 -e DURATION=30s benchmark.js
```

Mở trình duyệt: **http://127.0.0.1:5665**

Xuất báo cáo HTML khi test xong:

```cmd
set K6_WEB_DASHBOARD=true
set K6_WEB_DASHBOARD_EXPORT=report.html
k6 run ... benchmark.js
```

PowerShell:

```powershell
$env:K6_WEB_DASHBOARD="true"
$env:K6_WEB_DASHBOARD_OPEN="true"
k6 run benchmark.js
```

## 2. Chuẩn bị trên gateway (Droplet)

1. Gateway đang chạy
2. Route bench: `/v1/api/bench/get` → mock local `127.0.0.1:8089` (`scripts/mock-upstream.py`)
3. OAuth client (Dashboard → Client Registry) — copy `client_id` + `secret`
4. **Tắt rate limit** khi đo RPS (Cài đặt + route `rate_limit = 0`)
5. Bật **Health check** nếu test `SCENARIO=health`

## 3. Chạy benchmark

Mở CMD, `cd` vào thư mục `k6` của repo:

```cmd
cd C:\path\to\avaso-gateway\k6
```

### Test 1 — Health (baseline, không JWT)

```cmd
k6 run -e BASE_URL=https://thientinh.io.vn -e SCENARIO=health -e VUS=50 -e DURATION=30s benchmark.js
```

### Test 2 — JWT + routing (full pipeline)

```cmd
k6 run -e BASE_URL=https://thientinh.io.vn -e SCENARIO=jwt ^
  -e CLIENT_ID=avaso_pk_XXXX -e CLIENT_SECRET=avaso_sk_XXXX ^
  -e DATA_PLANE_PATH=/v1/api/get -e VUS=50 -e DURATION=30s benchmark.js
```

(PowerShell: thay `^` bằng backtick `` ` `` ở cuối dòng.)

### 4 mức concurrent (báo cáo)

**Cách nhanh (Windows CMD):**

```cmd
cd k6
run-suite.cmd health
set CLIENT_ID=avaso_pk_...
set CLIENT_SECRET=avaso_sk_...
run-suite.cmd jwt
```

Script tự chạy VUS **50 → 100 → 250 → 500**. Ghi số vào [`results/BENCHMARK_TABLE.md`](results/BENCHMARK_TABLE.md).

Lặp lại thủ công, đổi `VUS`:

| Lần | VUS |
|-----|-----|
| 1 | 50 |
| 2 | 100 |
| 3 | 250 |
| 4 | 500 |

```cmd
k6 run -e BASE_URL=https://thientinh.io.vn -e SCENARIO=jwt -e VUS=100 -e DURATION=30s ^
  -e CLIENT_ID=... -e CLIENT_SECRET=... -e DATA_PLANE_PATH=/v1/api/get benchmark.js
```

### Ghi file JSON (đính báo cáo)

```cmd
k6 run ... --out json=result-100vu.json benchmark.js
```

## 4. Theo dõi CPU/RAM (SSH Droplet)

Trong lúc k6 chạy trên Windows:

```bash
htop
# hoặc
ps -o rss= -p $(pgrep avaso-gateway)
```

Ghi bảng: VUS | Req/s | avg | p95 | error% | CPU | RAM

## Biến môi trường

| Biến | Mặc định | Mô tả |
|------|----------|--------|
| `BASE_URL` | `http://127.0.0.1:3000` | URL gateway |
| `SCENARIO` | `health` | `health` hoặc `jwt` |
| `VUS` | `50` | Số user ảo (concurrent) |
| `DURATION` | `30s` | Thời gian test |
| `CLIENT_ID` | — | OAuth client_id (bắt buộc nếu `jwt`) |
| `CLIENT_SECRET` | — | OAuth secret (bắt buộc nếu `jwt`) |
| `DATA_PLANE_PATH` | `/v1/api/get` | Path data plane |
| `SLEEP` | `0` | Giây nghỉ giữa các request (0 = spam tối đa) |

## Lưu ý

- Toàn **429** → rate limit đang bật; tắt trước khi bench
- **401** → sai CLIENT_ID/SECRET hoặc client inactive
- Health **disabled** → bật trong Cài đặt hoặc chỉ dùng `SCENARIO=jwt`

Chi tiết wrk/script cũ: [`docs/BENCHMARK.md`](../docs/BENCHMARK.md)

## Benchmark C — so sánh direct vs gateway

Direct httpbin (không qua gateway):

```cmd
k6 run -e BASE_URL=https://httpbin.org -e VUS=50 -e DURATION=30s benchmark-direct.js
```

Gateway (cùng VUs):

```cmd
k6 run -e BASE_URL=https://thientinh.io.vn -e SCENARIO=jwt -e VUS=50 -e DURATION=30s ^
  -e CLIENT_ID=... -e CLIENT_SECRET=... -e DATA_PLANE_PATH=/v1/api/get benchmark.js
```

Overhead % = `(RPS_direct - RPS_gateway) / RPS_direct × 100`

Bảng điền kết quả: [`results/BENCHMARK_TABLE.md`](results/BENCHMARK_TABLE.md)
