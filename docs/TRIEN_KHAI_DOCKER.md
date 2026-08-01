# Triển khai Docker Container — AVASO Gateway

Tài liệu mô tả **Docker Compose Deployment** — đóng gói và chạy AVASO Gateway bằng Docker và Docker Compose (local dev + production container).

Production hiện tại trên VPS dùng **systemd + binary release** — xem [`deploy/systemd/README.md`](../deploy/systemd/README.md) và [`VAN_HANH.md`](VAN_HANH.md). Docker phù hợp dev local, CI, và **Docker Compose Deployment** trong luận văn.

---

## 1. Tổng quan

| Thành phần | File | Mục đích |
|------------|------|----------|
| Image gateway | `Dockerfile` | Build multi-stage: Rust binary + React `web/dist` |
| Compose dev | `docker-compose.yml` | PostgreSQL + Redis + 1 gateway |
| Compose 2 instance *(thử)* | `docker-compose.ha.yml` | PostgreSQL + Redis + 2 gateway + Nginx LB |
| Cấu hình LB | `deploy/nginx/docker-ha.conf` | Round-robin data plane, sticky admin |

### Sơ đồ dev local

```text
Host :13000
    │
    ▼
┌─────────────┐
│  gateway    │  avaso-gateway binary + web/dist
│  :3000      │  (publish host 13000 → container 3000)
└──────┬──────┘
       │
   ┌───┴───┐
   ▼       ▼
postgres  redis
 (host 15432 / 16379 — trong mạng Docker vẫn :5432 / :6379)
```

### Sơ đồ Compose 2 instance *(thử nghiệm — không gọi HA trong báo cáo)*

```text
Host :8080
    │
    ▼
┌─────────────┐
│  nginx-lb   │
└──────┬──────┘
       │
   ┌───┴───────────────┐
   ▼                   ▼
middleware-1      middleware-2
   :3000              :3000
       │                   │
       └─────────┬─────────┘
                 ▼
          postgres + redis (dùng chung)
```

**Ghi chú:** Session admin qua Redis chung — dùng để **thử** 2 container. **Không** viết High Availability trong luận văn.

---

## 2. Dockerfile — cách build image

Image dùng **multi-stage build** để image runtime nhỏ:

| Stage | Base | Việc làm |
|-------|------|----------|
| `rust-build` | `rust:1-alpine` | `cargo build --release` |
| `web-build` | `node:20-alpine` | `npm ci` + `npm run build` |
| `runtime` | `alpine:3.19` | Copy binary, `web/dist`, `config.yaml`, `migrations` |

**Artifact trong container:**

```
/app/avaso-gateway      # binary
/app/web/dist/          # Admin SPA
/app/config.yaml        # seed lần đầu
/app/migrations/        # SQL migration
```

**Biến môi trường mặc định trong image:**

```dockerfile
DATABASE_URL=postgres://avaso:avaso@postgres:5432/avaso_gateway
REDIS_URL=redis://redis:6379
PG_POOL_MAX=5
PORT=3000
BIND_HOST=0.0.0.0
COOKIE_SECURE=false
INSTANCE_NAME=gateway
```

Compose ghi đè các giá trị này qua `environment` và `env_file`.

**Build thủ công:**

```bash
cd /root/avaso-gateway
docker build -t avaso-gateway:latest .
```

Thời gian build lần đầu khoảng 5–15 phút tùy CPU — Rust compile trong container.

---

## 3. Dev local — `docker-compose.yml`

### 3.1 Chuẩn bị

Không bắt buộc copy `.env`. Compose đọc `.env.example`; nếu có file `.env` thì ghi đè thêm.

```bash
cd /path/to/avaso-gateway
# (tuỳ chọn) copy .env.example .env rồi sửa mật khẩu
```

`DATABASE_URL` và `REDIS_URL` trong compose **ghi đè** sang hostname service Docker `postgres` / `redis`, không dùng `127.0.0.1`.

### 3.2 Chạy

```bash
docker compose up --build -d
docker compose ps
curl -sS http://127.0.0.1:13000/health | python3 -m json.tool
```

### 3.3 Service và port

| Service | Image / build | Port host | RAM limit |
|---------|---------------|-----------|-----------|
| postgres | postgres:16-alpine | 127.0.0.1:15432 | 512M |
| redis | redis:7-alpine | 127.0.0.1:16379 | 192M |
| gateway | build `.` | 127.0.0.1:13000 | 384M |

Port host lệch `:5432` / `:6379` / `:3000` mặc định — tránh trùng service local (Windows). Chỉ bind localhost.

### 3.4 Volume

- `postgres-data` — dữ liệu PostgreSQL persist giữa các lần `docker compose down` không kèm `-v`.

### 3.5 Log và debug

```bash
docker compose logs -f gateway
docker compose restart gateway
docker compose down          # giữ volume
docker compose down -v       # xóa volume DB — reset sạch
```

### 3.6 Truy cập Dashboard

Mở trình duyệt: `http://127.0.0.1:13000`  
Đăng nhập bằng `ADMIN_USERNAME` / `ADMIN_PASSWORD` trong `.env.example` (hoặc `.env` nếu có).

`COOKIE_SECURE=false` trong Docker — cookie hoạt động trên HTTP.

---

## 4. Compose thử nghiệm 2 instance — `docker-compose.ha.yml`

Thử **container hóa** với hai gateway sau Nginx LB. **Không** chứng minh HA production — không dùng từ HA / High Availability trong Word.

### 4.1 Chạy

```bash
cd /root/avaso-gateway
cp .env.example .env   # nếu chưa có
docker compose -f docker-compose.ha.yml up --build -d
```

Load balancer: **http://127.0.0.1:8080**

### 4.2 Service

| Container | Vai trò |
|-----------|---------|
| `avaso-postgres` | PostgreSQL dùng chung |
| `avaso-redis` | Redis session dùng chung |
| `middleware-instance-1` | Gateway instance 1 |
| `middleware-instance-2` | Gateway instance 2 |
| `nginx-lb` | Nginx reverse proxy + LB |

Gateway **không** publish port ra host — chỉ `expose: 3000` trong network Docker. Client truy cập qua Nginx `:8080`.

### 4.3 Cấu hình Nginx LB

File `deploy/nginx/docker-ha.conf`:

- `/api/*` — **ip_hash** sticky: session admin ổn định trên một instance
- `/v1/*` và `/` — **round-robin**: data plane phân tải giữa hai instance
- Header `X-Gateway-Instance` — gateway trả về tên instance để quan sát LB

### 4.4 Script demo tự động

```bash
./scripts/docker-ha-demo.sh
```

Script thực hiện:

1. Gọi `/health` qua LB — quan sát instance xen kẽ
2. `docker stop middleware-instance-1`
3. Gọi lại `/health` — chỉ còn instance-2, vẫn HTTP 200
4. `docker start middleware-instance-1`

### 4.5 Demo thủ công cho Hội đồng

1. Mở `http://127.0.0.1:8080` — đăng nhập admin
2. Mở tab DevTools → Network — thấy cookie `gw_sid`
3. Chạy `docker stop middleware-instance-1`
4. F5 Dashboard — vẫn đăng nhập vì session trong Redis và LB chuyển sang instance-2
5. `docker start middleware-instance-1`

### 4.6 Dừng stack thử nghiệm

```bash
docker compose -f docker-compose.ha.yml down
docker compose -f docker-compose.ha.yml down -v   # xóa DB demo
```

### 4.7 Lưu ý tài nguyên

File compose ghi chú: **2 instance gateway nặng trên VPS 2GB** — dùng cho demo ngắn, không chạy production lâu dài trên máy yếu. Production thực tế: một instance systemd hoặc scale trên máy lớn hơn.

---

## 5. Biến môi trường trong Docker

| Biến | Dev compose | HA compose | Ghi chú |
|------|-------------|------------|---------|
| `DATABASE_URL` | `@postgres:5432` | `@postgres:5432` | Hostname service |
| `REDIS_URL` | `redis://redis:6379` | `redis://redis:6379` | Bắt buộc session |
| `BIND_HOST` | `0.0.0.0` | `0.0.0.0` | Listen trong container |
| `PG_POOL_MAX` | `5` | `4` | Giảm trên HA 2 instance |
| `INSTANCE_NAME` | mặc định | `middleware-instance-1/2` | Header debug LB |
| `COOKIE_SECURE` | từ `.env` | `false` | HA local HTTP |

Các biến khác lấy từ `.env`: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `CLIENT_KEY_MASTER_KEY`, `INTEGRATION_MASTER_KEY`, `INTEGRATION_SYNC_INTERVAL_MINS`, v.v.

**OAuth Salesforce/Zoho:** Client ID và Secret cấu hình trên Dashboard sau khi container chạy — không đặt trong Dockerfile.

Compose mặc định chưa mount `data/` — phù hợp dev. Production Docker nên mount volume cho `data/` nếu cần persist evidence/log local.

---

## 6. Migration database

Gateway tự chạy migration SQL trong `migrations/` khi khởi động — kết nối `DATABASE_URL` và áp dụng lên PostgreSQL container.

Lần đầu `docker compose up`: postgres healthy → gateway start → schema tạo tự động.

---

## 7. So sánh Docker và systemd production

| Tiêu chí | Docker Compose | systemd trên VPS |
|----------|----------------|------------------|
| Mục đích | Dev, Compose Deployment, CI | Production `thientinh.io.vn` |
| TLS HTTPS | Không — HTTP local | Nginx host + Let's Encrypt |
| Số instance | 1 hoặc 2 + LB | 1 gateway + Nginx |
| Cập nhật | `docker compose up --build` | `cargo build --release` + restart |
| Persist PDF/data | Cần mount volume | Thư mục `data/` trên host |
| Phù hợp luận văn | Chương triển khai — **Docker Compose Deployment** | Chương triển khai thực tế VPS |

Cả hai dùng **cùng Dockerfile logic** — binary và SPA giống nhau.

---

## 8. Kiểm tra sau triển khai Docker

```bash
# Health
curl -sS http://127.0.0.1:13000/health

# Smoke test — chỉnh GATEWAY_BASE nếu dùng HA :8080
GATEWAY_BASE_URL=http://127.0.0.1:13000 ./scripts/smoke-test.sh

# Trạng thái container
docker compose ps
docker stats --no-stream
```

---

## 9. Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Xử lý |
|-------------|-------------|--------|
| `gateway` restart loop | Sai `DATABASE_URL` / postgres chưa ready | `docker compose logs gateway`; đợi healthcheck postgres |
| Build Rust lâu / hết RAM | VPS 2GB | Tăng swap hoặc build trên máy mạnh hơn rồi push image |
| Login admin fail trên HA | Cookie domain | Dùng đúng `http://127.0.0.1:8080`, không trộn localhost:3000 |
| OAuth redirect lỗi | Callback URL | Cấu hình `GATEWAY_PUBLIC_URL` trỏ URL public thật, không dùng Docker local cho OAuth production |
| Port host busy | App khác chiếm 13000/15432/16379 | Đổi `ports:` trong `docker-compose.yml` |

---

## 10. Tài liệu liên quan

| File | Nội dung |
|------|----------|
| [`TRIEN_KHAI.md`](TRIEN_KHAI.md) | Tổng quan mọi mô hình triển khai |
| [`TRIEN_KHAI_DOCKER.md`](TRIEN_KHAI_DOCKER.md) | Docker Compose Deployment (§4 = thử 2 instance) |
| [`VAN_HANH.md`](VAN_HANH.md) | Runbook production systemd |
| [`deploy/systemd/README.md`](../deploy/systemd/README.md) | Cài đặt VPS chi tiết |
