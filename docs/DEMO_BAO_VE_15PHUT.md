# Checklist demo bảo vệ — 15 phút

> Môi trường: **https://thientinh.io.vn**  
> Chạy checklist **trước buổi bảo vệ** — live chỉ show UI + vài lệnh ngắn.

---

## Thứ tự test (làm đúng thứ tự này)

| # | Test | Làm gì | Xem ở đâu | Pass? |
|---|------|--------|------------|-------|
| 1 | Health | `curl /health` | Terminal JSON | ☐ |
| 2 | Login admin | Browser login | Dashboard Overview | ☐ |
| 3 | Login viewer | Browser login viewer | Menu bị ẩn / 403 | ☐ |
| 4 | OAuth client | Tạo hoặc copy client | Auth → Clients | ☐ |
| 5 | JWT 401 | Proxy Try không token | HTTP 401 | ☐ |
| 6 | JWT 200 | Proxy Try đổi token + gọi API | HTTP 200 | ☐ |
| 7 | Routing 405 | Route chỉ GET, gọi POST | HTTP 405 | ☐ |
| 8 | Rate limit 429 | 8 request liên tiếp | HTTP 429 + Retry-After | ☐ |
| 9 | DLQ | Gọi route 503 | Proxy Queue pending | ☐ |
| 10 | DLQ replay | Replay trên UI | status replayed | ☐ |
| 11 | Logs | Mở Logs | Transaction + Audit có dòng mới | ☐ |
| 12 | Integrations | Mở Integrations (không bấm OAuth) | Connected + snapshot + sync log | ☐ |
| 13 | Smoke im lặng | `smoke-test.sh` (không show live) | Terminal All passed | ☐ |

---

## 0. Chuẩn bị trước khi test

- [ ] Có pass **admin** và **viewer** (ghi notepad)
- [ ] Browser: Chrome/Firefox, tab ẩn danh cho viewer
- [ ] Terminal mở sẵn tại thư mục project
- [ ] Copy sẵn `client_id` + `secret` (Auth → Clients)

---

## 1. Health (0–1 phút demo)

**Lệnh:**

```bash
curl -sS https://thientinh.io.vn/health | python3 -m json.tool
```

**Pass khi:**
- HTTP 200
- `"status": "ok"` (hoặc `degraded` nhưng vẫn chạy — giải thích latency PG/Redis)
- Có `postgres` và `redis` trong response

**Nói khi demo:** *Hệ thống chạy VPS Ubuntu, Nginx TLS, PostgreSQL + Redis.*

---

## 2. Dashboard + RBAC (1–3 phút demo)

### 2a. Admin

1. Mở https://thientinh.io.vn/login
2. Login **admin**
3. Vào **Tổng quan** (`/`)

**Xem:**
- Stats (routes, clients, requests…)
- Banner middleware pipeline (JWT → rate limit → route → ACL → proxy)

### 2b. Viewer

1. Tab ẩn danh → login **viewer**
2. Thử vào **Users** hoặc **Integrations**

**Pass khi:**
- Không thấy menu admin-only, hoặc trang trả 403 / redirect

**Nói:** *Control plane: session Redis + RBAC backend.*

---

## 3. JWT — trọng tâm (3–7 phút demo)

### Chuẩn bị

Auth → **OAuth & Clients** → chọn client → copy:
- `client_id` (`avaso_pk_...`)
- `secret` (`avaso_sk_...`) — chỉ hiện 1 lần lúc tạo; rotate nếu mất

### 3a. Không token → 401

**Cách 1 — UI (khuyến nghị):**
1. **Thử gọi proxy** (`/proxy-try`)
2. Chọn client, **không** đổi token (hoặc xóa Bearer)
3. Gọi `GET /v1/api/get`

**Xem:** Status **401**, body lỗi `missing_token` / tương đương

**Cách 2 — Terminal:**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://thientinh.io.vn/v1/api/get
# Kỳ vọng: 401
```

### 3b. Đổi token + gọi API → 200

**UI:**
1. Proxy Try → **Đổi token** (`client_credentials`)
2. Gọi `GET /v1/api/get` (hoặc path route có sẵn)

**Xem:** HTTP **200** (hoặc 404 nếu upstream không có — giải thích upstream status)

**Terminal (optional):**

```bash
export GATEWAY_BASE_URL=https://thientinh.io.vn
export BENCH_API_KEY=avaso_pk_...
export BENCH_SECRET_KEY=avaso_sk_...
python3 scripts/test_jwt_auth.py
```

**Nói:** *Secret chỉ tại token endpoint. Data plane chỉ Bearer JWT. Gateway strip Authorization trước upstream.*

---

## 4. Routing (7–8 phút demo)

1. **Routes** → mở route ví dụ `/v1/api/get`
2. Xem `target` upstream, `allowed_methods`
3. Proxy Try → `GET` → **200**
4. Proxy Try → `POST` (nếu route chỉ GET) → **405**

**Nói:** *Dynamic routing, method filter, ACL per client.*

---

## 5. Rate limit (8–9 phút demo)

**Chuẩn bị:** Client đặt `rate_limit_per_min = 10` (Auth → sửa client).

**Lệnh (8 request):**

```bash
export GATEWAY_BASE=https://thientinh.io.vn
export API_KEY=avaso_pk_...
export SECRET_KEY=avaso_sk_...
source scripts/lib/jwt_token.sh
TOKEN=$(fetch_jwt_token)

for i in $(seq 1 8); do
  curl -s -D /tmp/rl_hdr.txt -o /dev/null -w "$i: %{http_code}\n" \
    -H "Authorization: Bearer $TOKEN" \
    https://thientinh.io.vn/v1/api/get
done
grep -i retry-after /tmp/rl_hdr.txt
```

**Pass khi:** Cuối có **429**, header `Retry-After`

**Không ra 429:** Đợi 1 phút reset bucket hoặc dùng client mới limit=5.

---

## 6. DLQ (9–11 phút demo)

### Chuẩn bị (làm trước)

1. **Settings** → bật **Dead-letter queue**
2. **Routes** → route `/v1/api/status/503` → target `https://httpbin.org/status/503`
3. Client có ACL route này

### Test

```bash
export GATEWAY_BASE=https://thientinh.io.vn
export API_KEY=... SECRET_KEY=...
./scripts/demo-proxy-queue.sh
```

**Xem UI:**
1. **Proxy Queue** → Refresh
2. Bản ghi **pending**
3. Bấm **Replay** → **replayed**

**Nói:** *Retry thất bại → DLQ PostgreSQL → operator replay.*

---

## 7. Logs (11–12 phút demo)

**Logs** (`/logs`):

| Tab | Xem gì |
|-----|--------|
| Transaction | Request Proxy Try vừa gọi: method, path, status, ms |
| Audit | Login, replay DLQ, sửa route |

**Nói:** *Transaction log async data plane; audit log admin plane.*

---

## 8. Integrations (12–14 phút demo)

**Chỉ mở — không bấm Connect / Sync Now / Test**

1. **Integrations** → status **Connected** (SF + Zoho)
2. **Snapshots** — có bản ghi
3. **Sync logs** — có lịch sử
4. **Entity links** — mapping SF↔Zoho
5. **Pipeline** — 4 bước

**Nói:** *Extension layer; mọi call SF/Zoho qua data plane JWT pipeline.*

**Không chạy live:** `test-integrations.sh`, `test-integration-proxy.sh`

---

## 9. Benchmark (14–15 phút demo)

**Chỉ slide** — file: [`k6/results/BENCHMARK_TABLE.md`](../k6/results/BENCHMARK_TABLE.md)

| Scenario | RPS | p50 |
|----------|-----|-----|
| /health | 2248 | 19.4 ms |
| JWT full pipeline | 275 | 143.2 ms |
| Overhead | — | ~140 ms |

**Nói:** *VPS 2vCPU 2GB; overhead do JWT + Redis + logging; hướng tối ưu tương lai.*

**Không chạy:** k6, wrk live.

---

## 10. Smoke im lặng (không show hội đồng)

```bash
SMOKE_BASE_URL=https://thientinh.io.vn \
SMOKE_ADMIN_USER=admin \
SMOKE_ADMIN_PASS='MAT_KHAU_ADMIN' \
./scripts/smoke-test.sh
```

**Pass:** `All smoke checks passed.`

---

## Không demo live

| Cái | Lý do |
|-----|-------|
| PKCE | Nhiều bước, dễ lỗi — chỉ slide |
| `test-integrations.sh` | SF/Zoho timeout |
| `smoke-test.sh` | Output dài |
| Benchmark live | Mất thời gian, không ổn định |

---

## Tab browser mở sẵn trước buổi

1. Tổng quan
2. OAuth & Clients
3. Thử gọi proxy
4. Routes
5. Proxy Queue
6. Logs
7. Integrations
8. Slide benchmark

---

## Backup khi lỗi

| Lỗi | Làm gì |
|-----|--------|
| Proxy 502 | Show transaction log cũ |
| Không 429 | Screenshot đã test / bỏ qua |
| DLQ trống | Replay bản ghi cũ |
| Integrations disconnect | Show sync log + pipeline |
| Health degraded | Giải thích latency, vẫn demo nếu status ok |

---

## Timeline live (tóm tắt)

| Phút | Nội dung |
|------|----------|
| 0–1 | Health curl |
| 1–3 | Dashboard + viewer 403 |
| 3–7 | JWT Proxy Try |
| 7–8 | Routes 405 |
| 8–9 | Rate limit 8 req |
| 9–11 | DLQ replay |
| 11–12 | Logs |
| 12–14 | Integrations UI |
| 14–15 | Benchmark slide |
