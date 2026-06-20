# AVASO Gateway

## Thông tin sinh viên

| | |
|---|---|
| **Họ tên** | Nguyễn Phúc Thiên Tinh |
| **MSSV** | DH52201572 |
| **Lớp** | D22_TH11 |

---

## Giới thiệu

**AVASO Gateway** là hệ thống API Gateway đa tích hợp, phát triển cho đồ án tốt nghiệp. Hệ thống gồm backend Rust (Axum), cơ sở dữ liệu PostgreSQL, Redis cho session admin, và giao diện quản trị React SPA.

**Demo production:** [https://thientinh.io.vn](https://thientinh.io.vn)
**Script Database:** [docs/schema_full_postgresql.sql]

### Công nghệ

| Thành phần | Công nghệ |
|------------|-----------|
| Backend | Rust, Axum, Tokio, SQLx |
| Cơ sở dữ liệu | PostgreSQL 16 |
| Cache / session | Redis 7 |
| Frontend | React, TypeScript, Vite |
| Reverse proxy | Nginx (TLS) |
| Triển khai | systemd, Docker Compose |

---

## Tính năng chính

| Lớp | Mô tả |
|-----|--------|
| **Data plane** | Reverse proxy theo route; prefix `/v1/api/*`; xác thực HMAC-SHA256 + chống replay; rate limit token bucket |
| **Admin plane** | REST `/api/*` — session cookie hoặc `X-API-Key` admin; RBAC admin / operator / viewer |
| **Bảo mật** | Argon2id mật khẩu; AES-256-GCM mã hóa client key; audit log; transaction log |
| **Tích hợp** | Salesforce + Zoho Projects OAuth; proxy data-plane; đồng bộ snapshot |
| **Mở rộng** | Request transform, retry, hàng đợi DLQ (bật/tắt runtime) |
| **Dashboard** | React SPA trong `web/` — build ra `web/dist/` |

---

## Kiến trúc hệ thống

```
Client ──► Nginx (TLS) ──► avaso-gateway :3000 (localhost)
                              ├── /health, /metrics
                              ├── /v1/api/*     → HMAC auth → proxy upstream
                              ├── /api/*        → admin API (session / admin key)
                              └── /*            → static web/dist/ (SPA)
```

| Thành phần | Lưu trữ | Ghi chú |
|------------|---------|---------|
| Route, user, key, integration, log | **PostgreSQL** | Seed lần đầu từ `config.yaml` |
| Session admin | **Redis** | Key `gw:session:{id}`, TTL 24h; dùng chung giữa nhiều instance |
| HMAC replay cache, proxy queue | **In-memory** | Mất khi restart process |

Migration SQL tự chạy khi gateway khởi động (`migrations/`).

---

## Yêu cầu hệ thống

- **Rust** ≥ 1.85 (`rustup`, `cargo`)
- **Node.js** ≥ 20 (`npm`)
- **PostgreSQL** 16 + client `psql`, `pg_dump`
- **Redis** 7
- *(Tùy chọn)* Docker + Docker Compose

---

## Cài đặt và chạy

### 1. Dev local (cargo)

```bash
# PostgreSQL + Redis (chọn một)
docker compose up -d postgres redis
# hoặc: sudo systemctl start postgresql redis-server

cp .env.example .env   # chỉnh secret trước khi public
cargo run
```

```bash
# Frontend (terminal khác)
cd web && npm install && npm run dev
# Production build: npm run build  → web/dist/
```

- Gateway: `http://127.0.0.1:3000/` (sau `npm run build`)
- Vite dev: `http://127.0.0.1:5173/` (proxy `/api` → gateway)

**Lưu ý:** `ADMIN_PASSWORD` trong `.env` chỉ bootstrap lần đầu khi bảng `dashboard_users` trống. Đổi mật khẩu sau login qua UI **Users** — sửa `.env` không đổi pass trong DB.

### 2. Docker Compose

```bash
cp .env.example .env
docker compose up --build
# http://127.0.0.1:3000 — BIND_HOST=0.0.0.0 trong compose
```

Chi tiết: [`docs/TRIEN_KHAI_DOCKER.md`](docs/TRIEN_KHAI_DOCKER.md).

### 3. Production (Ubuntu)

```bash
cargo build --release
cd web && npm run build && npm test
sudo cp deploy/systemd/avaso-gateway.service /etc/systemd/system/
sudo systemctl enable --now avaso-gateway
```

Nginx reverse proxy tới `127.0.0.1:3000` — xem [`deploy/nginx/thientinh.io.vn.conf`](deploy/nginx/thientinh.io.vn.conf), [`deploy/systemd/README.md`](deploy/systemd/README.md).

---

## Cơ sở dữ liệu

### Schema

| Nguồn | Mô tả |
|-------|--------|
| `migrations/` | Migration thực tế gateway áp dụng khi start |
| [`docs/schema_full_postgresql.sql`](docs/schema_full_postgresql.sql) | DDL đầy đủ (tham chiếu tài liệu) |
``

./scripts/export-db.sh
# hoặc
./scripts/export-db.sh schema
```

Tạo/cập nhật file tham chiếu trong `docs/`:

```bash
python3 scripts/generate_schema_sql.py --style clean --out docs/schema_full_postgresql.sql
```

**Output:**

| File | Nội dung |
|------|----------|
| `exports/db/avaso_gateway_schema_YYYYMMDD_HHMMSS.sql` | DDL dictionary có timestamp |
| `exports/db/avaso_gateway_schema_latest.sql` | Bản mới nhất — **nộp file này** |
| [`docs/schema_full_postgresql.sql`](docs/schema_full_postgresql.sql) | Cùng nội dung, lưu trong repo |

**Tuỳ chọn — snapshot DB thực tế** (cần PostgreSQL + `DATABASE_URL`):

```bash
./scripts/export-db.sh dump   # pg_dump schema + data
./scripts/export-db.sh data   # pg_dump chỉ INSERT
```

Script đọc `DATABASE_URL` từ `.env` hoặc `/etc/avaso-gateway/env` khi dùng `dump`/`data`.

**Giảng viên tạo DB từ dictionary:**

```bash
createdb avaso_gateway_review
psql "postgres://avaso:avaso@127.0.0.1:5432/avaso_gateway_review" \
  -f exports/db/avaso_gateway_schema_latest.sql
```

---

## Kiểm thử

```bash
cargo test                    # unit tests (crypto, RBAC, HMAC, rate limit)
cd web && npm run build
./scripts/smoke-test.sh       # health + login (cần gateway đang chạy)
python3 scripts/test_hmac_replay.py  # HMAC replay (cần client key)
```

CI: GitHub Actions — [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

Kịch bản demo bảo vệ: [`docs/DEMO_BAO_VE.md`](docs/DEMO_BAO_VE.md).

---

## Cấu hình

| File | Vai trò |
|------|---------|
| `.env` | `DATABASE_URL`, `REDIS_URL`, admin bootstrap, `CLIENT_KEY_MASTER_KEY`, OAuth, CORS |
| `config.yaml` | Rate limit mặc định, seed routes, feature toggles |
| `web/.env` | `VITE_API_BASE_URL`, `VITE_GATEWAY_ORIGIN` (dev) |

Biến môi trường quan trọng:

| Biến | Mặc định | Mô tả |
|------|----------|--------|
| `DATABASE_URL` | `postgres://avaso:avaso@127.0.0.1:5432/avaso_gateway` | PostgreSQL |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Session admin |
| `PORT` | `3000` | Cổng gateway |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `change-me-...` | Bootstrap user lần đầu |

---

## Admin API (tóm tắt)

Tất cả dưới prefix **`/api`**:

| Nhóm | Endpoint |
|------|----------|
| Auth | `POST /api/login`, `POST /api/logout`, `GET /api/me` |
| Routes | `GET/POST /api/routes`, `PUT/DELETE /api/routes/:id` |
| Client keys | `GET/POST /api/client-keys`, `DELETE /api/client-keys/:id` |
| Users | `GET/POST/PUT/DELETE /api/users` |
| Logs | `GET /api/audit-logs`, `GET /api/transaction-logs` |
| Settings | `GET/PUT /api/settings`, `GET /api/dashboard/stats` |
| Integrations | `GET /api/integrations/*` (Salesforce, Zoho OAuth + sync) |

Tài liệu đầy đủ: UI **Tài liệu API** hoặc [`docs/TEAM_RUNBOOK.md`](docs/TEAM_RUNBOOK.md).

### Data plane auth (HMAC)

Header: `X-API-Key`, `X-Timestamp`, `X-Signature`.

Payload ký: `{api_key}\n{timestamp}\n{METHOD}\n{path_with_query}\n{body}`.

Luồng chi tiết: [`docs/HMAC_MIDDLEWARE_FLOW.md`](docs/HMAC_MIDDLEWARE_FLOW.md).

---

## Cấu trúc thư mục

```
avaso-gateway/
├── src/                 # Backend Rust
├── web/                 # Frontend React
│   ├── src/             # Source — sửa code ở đây
│   └── dist/            # Build output (gitignore)
├── migrations/          # SQL migration PostgreSQL
├── scripts/             # Smoke test, benchmark, export DB, ...
├── deploy/              # systemd, nginx, VPS scripts
├── docs/                # Báo cáo, runbook, schema tham chiếu
├── exports/db/          # SQL export (gitignore — tạo bằng export-db.sh)
├── config.yaml          # Seed routes & toggles
├── docker-compose.yml
└── .env.example
```

**Không sửa tay `web/dist/`** — luôn `npm run build` sau khi đổi UI.

---

## Tài liệu đồ án

| Tài liệu | Nội dung |
|----------|----------|
| [`docs/BAO_CAO.md`](docs/BAO_CAO.md) | Outline báo cáo luận văn |
| [`docs/BAN_VE_HE_THONG.md`](docs/BAN_VE_HE_THONG.md) | Bản vẽ kỹ thuật (SSOT) |
| [`docs/DEMO_BAO_VE.md`](docs/DEMO_BAO_VE.md) | Kịch bản demo bảo vệ |
| [`docs/MA_TRAN_DONG_AN.md`](docs/MA_TRAN_DONG_AN.md) | Ma trận FR ↔ code |
| [`docs/MO_HINH_BAO_MAT.md`](docs/MO_HINH_BAO_MAT.md) | Mô hình bảo mật |
| [`docs/BENCHMARK.md`](docs/BENCHMARK.md) | Benchmark NFR |
| [`docs/TICH_HOP_SALESFORCE.md`](docs/TICH_HOP_SALESFORCE.md) | Tích hợp Salesforce |
| [`docs/TICH_HOP_ZOHO_PROJECTS.md`](docs/TICH_HOP_ZOHO_PROJECTS.md) | Tích hợp Zoho Projects |
| [`docs/README.md`](docs/README.md) | Mục lục tài liệu đầy đủ |

**Bảo vệ — trace FR + benchmark:**

```bash
./scripts/collect-thesis-evidence.sh
```

**Xử lý sự cố 502:**

```bash
sudo bash deploy/fix-502.sh
# hoặc xem docs/XU_LY_502_BAD_GATEWAY.md
```

---

## License

MIT — see [LICENSE](LICENSE).
