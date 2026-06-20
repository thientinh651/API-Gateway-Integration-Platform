# AVASO Gateway - Bo sung thong tin
Thong tin sinh vien
Xuất DB ra script
API Gateway đơn node — Rust (Axum) + PostgreSQL + Redis + React admin UI. Production demo: [thientinh.io.vn](https://thientinh.io.vn).

## Tính năng chính

| Lớp | Mô tả |
|-----|--------|
| **Data plane** | Reverse proxy theo route; prefix `/v1/api/*`; HMAC-SHA256 + replay guard; rate limit token bucket |
| **Admin plane** | REST `/api/*` — session cookie hoặc `X-API-Key` admin; RBAC admin / operator / viewer |
| **Bảo mật** | Argon2id mật khẩu; AES-256-GCM secret client key; audit log; transaction log SQLite |
| **Tích hợp** | Salesforce + Zoho Projects OAuth; proxy data-plane; snapshot sync |
| **Mở rộng** | Request transform, retry, DLQ queue (toggle runtime) |
| **Dashboard** | React SPA trong `web/` — build ra `web/dist/` |

## Kiến trúc nhanh

```
Client ──► Nginx (TLS) ──► avaso-gateway :3000 (localhost)
                              ├── /health, /metrics (stub JSON)
                              ├── /v1/api/*     → HMAC auth → proxy upstream
                              ├── /api/*        → admin API (session / admin key)
                              └── /*            → static web/dist/ (SPA)
```

- Route / users / integrations lưu **PostgreSQL**; seed lần đầu từ `config.yaml`.
- **Session admin:** Redis (`REDIS_URL`, module `src/session.rs`) — key `gw:session:{id}`, TTL 24h; dùng chung giữa nhiều instance.
- HMAC replay cache, proxy queue: **in-memory** (mất khi restart).

## Quickstart (dev)

```bash
# Backend — cần Redis session (docker compose up -d redis hoặc redis-server)
cp .env.example .env   # chỉnh secret trước khi public
cargo run

# Frontend (terminal khác)
cd web && npm install && npm run dev
# Production build: npm run build  → web/dist/
```

Mở `http://127.0.0.1:3000/` (sau build) hoặc `http://127.0.0.1:5173/` (dev).

**Lưu ý:** `ADMIN_PASSWORD` trong `.env` chỉ bootstrap lần đầu khi bảng `dashboard_users` trống. Đổi pass sau login qua UI Users — sửa `.env` không đổi pass DB.

## Kiểm thử

```bash
cargo test                    # unit tests (crypto, RBAC, HMAC, rate limit)
cd web && npm run build
./scripts/smoke-test.sh       # health + login (cần gateway đang chạy)
python3 scripts/test_hmac_replay.py  # HMAC replay (cần client key)
```

CI: GitHub Actions — `.github/workflows/ci.yml`.

## Cấu hình

| File | Vai trò |
|------|---------|
| `.env` | DB path, admin bootstrap, `CLIENT_KEY_MASTER_KEY`, OAuth SF/Zoho, CORS |
| `config.yaml` | Rate limit mặc định, seed routes, feature toggles |
| `web/.env` | `VITE_API_BASE_URL`, `VITE_GATEWAY_ORIGIN` (dev) |

Chi tiết production: [`deploy/systemd/README.md`](deploy/systemd/README.md), [`deploy/nginx/README.md`](deploy/nginx/README.md).

**Luận văn / bảo vệ:** [`docs/README.md`](docs/README.md) — 15 chức năng lớn, ma trận FR, sửa Word.

**502 / web không vào:** `sudo bash deploy/fix-502.sh` — hoặc [`docs/XU_LY_502_BAD_GATEWAY.md`](docs/XU_LY_502_BAD_GATEWAY.md)

**Bảo vệ đồ án — trace FR + benchmark:** [`docs/MA_TRAN_DONG_AN.md`](docs/MA_TRAN_DONG_AN.md) · [`docs/BENCHMARK.md`](docs/BENCHMARK.md) · `./scripts/collect-thesis-evidence.sh`

**Docker HA (2 instance + Nginx LB):** [`docs/DOCKER_HA_DEMO.md`](docs/DOCKER_HA_DEMO.md) · `docker compose -f docker-compose.ha.yml up --build`

## Admin API (tóm tắt)

Tất cả dưới prefix **`/api`**:

- `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET/POST /api/routes`, `PUT/DELETE /api/routes/:id`
- `GET/POST /api/client-keys`, `DELETE /api/client-keys/:id`
- `GET/POST/PUT/DELETE /api/users`
- `GET /api/audit-logs`, `GET /api/transaction-logs`
- `GET/PUT /api/settings`, `GET /api/dashboard/stats`
- `GET /api/integrations/*` (Salesforce, Zoho OAuth + sync)

Tài liệu đầy đủ: UI **Tài liệu API** hoặc [`docs/TEAM_RUNBOOK.md`](docs/TEAM_RUNBOOK.md).

## Data plane auth (HMAC)

Header: `X-API-Key`, `X-Timestamp`, `X-Signature`. Payload ký: `{api_key}\n{timestamp}\n{METHOD}\n{path_with_query}\n{body}`.

Flow: [`docs/HMAC_MIDDLEWARE_FLOW.md`](docs/HMAC_MIDDLEWARE_FLOW.md).

## Deploy (Ubuntu)

```bash
cargo build --release
cd web && npm run build          # → web/dist/
cd web && npm test               # Vitest
sudo cp deploy/systemd/avaso-gateway.service /etc/systemd/system/
sudo systemctl enable --now avaso-gateway
```

Nginx reverse proxy tới `127.0.0.1:3000` — xem [`deploy/nginx/thientinh.io.vn.conf`](deploy/nginx/thientinh.io.vn.conf).

## Docker (demo local)

```bash
cp .env.example .env
docker compose up --build
# http://127.0.0.1:3000 — BIND_HOST=0.0.0.0 trong compose
```

Demo bảo vệ: [`docs/DEMO_BAO_VE.md`](docs/DEMO_BAO_VE.md).

## Thư mục frontend (`web/`)

| Path | Mục đích |
|------|----------|
| `web/src/` | Source React — **sửa code ở đây** |
| `web/dist/` | Build output — gateway phục vụ (gitignore) |
| `npm run dev` | Vite :5173, proxy `/api` → gateway |

**Không sửa tay `web/dist/`** — luôn `npm run build` sau khi đổi UI.

## Tài liệu thêm

| Doc | Nội dung |
|-----|----------|
| [`docs/MO_HINH_BAO_MAT.md`](docs/MO_HINH_BAO_MAT.md) | Mô hình bảo mật |
| [`docs/HUONG_DAN_TEST_CHI_TIET.md`](docs/HUONG_DAN_TEST_CHI_TIET.md) | E2E manual |
| [`docs/TICH_HOP_SALESFORCE.md`](docs/TICH_HOP_SALESFORCE.md) | Salesforce OAuth |
| [`docs/TICH_HOP_ZOHO_PROJECTS.md`](docs/TICH_HOP_ZOHO_PROJECTS.md) | Zoho Projects |

## License

MIT — see [LICENSE](LICENSE).
