# PostgreSQL + Redis — cấu hình & xem dữ liệu

Gateway dùng **PostgreSQL** (state: routes, users, integrations, logs) và **Redis** (session admin).

## Biến môi trường

| Biến | Mặc định dev | Mô tả |
|------|----------------|--------|
| `DATABASE_URL` | `postgres://avaso:avaso@127.0.0.1:5432/avaso_gateway` | Connection string PostgreSQL |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis session (`gw:session:*`) |
| `SESSION_DB_RECHECK_SECS` | `60` | Đồng bộ role/disable từ PG → Redis |

File mẫu: [`.env.example`](../.env.example)

## Chạy nhanh (Docker)

```bash
cp .env.example .env
docker compose up --build -d
# Gateway: http://127.0.0.1:3000
# Postgres: localhost:5432  user=avaso  pass=avaso  db=avaso_gateway
# Redis:    localhost:6379
```

HA demo (2 gateway + LB):

```bash
docker compose -f docker-compose.ha.yml up --build -d
# LB: http://127.0.0.1:8080
```

## Chạy local (cargo) — cần PG + Redis trước

```bash
# Chỉ DB + Redis
docker compose up -d postgres redis

# Hoặc cài native:
#   sudo apt install postgresql redis-server
#   createdb avaso_gateway && createuser avaso ...

cp .env.example .env
cargo run
```

Migration tự chạy lúc startup (`sqlx::migrate!`).

## Xem & cấu hình PostgreSQL

### psql (trong container)

```bash
docker compose exec postgres psql -U avaso -d avaso_gateway
```

### Lệnh hữu ích

```sql
\dt                          -- danh sách bảng
SELECT * FROM gateway_routes;
SELECT username, role, tenant_id FROM dashboard_users;
SELECT provider, status, last_sync_at FROM integrations;
SELECT COUNT(*) FROM gateway_transaction_logs;
SELECT COUNT(*) FROM audit_logs;
```

### GUI (tuỳ chọn)

- **DBeaver**, **pgAdmin**, **TablePlus**
- Host `127.0.0.1`, port `5432`, user `avaso`, password `avaso`, database `avaso_gateway`

### Đổi mật khẩu / DB name

Sửa `docker-compose.yml` → `POSTGRES_*` và `DATABASE_URL` trong `.env` / `environment` gateway.

## Xem & cấu hình Redis

### redis-cli

```bash
docker compose exec redis redis-cli
KEYS gw:session:*
GET gw:session:<session_id>
TTL gw:session:<session_id>
KEYS gw:user_sessions:*
```

### Biến liên quan

| Key prefix | Nội dung |
|------------|----------|
| `gw:session:{id}` | JSON session (user_id, tenant_id, role) |
| `gw:user_sessions:{user_id}` | Set session id — revoke all |

Chi tiết: [SESSION_REDIS.md](./SESSION_REDIS.md)

## Health check

```bash
curl -sS http://127.0.0.1:3000/health | python3 -m json.tool
# database: "PostgreSQL"
# session_store: "redis" (nếu có trong response)
```

## Tune RAM Droplet 2GB

Xem **[VPS_2GB_TUNING.md](./VPS_2GB_TUNING.md)** — Redis `maxmemory 128mb`, Postgres `shared_buffers 128MB`, `PG_POOL_MAX=5`.

Trên Droplet:

```bash
sudo bash deploy/scripts/apply-vps-2gb-tuning.sh
bash scripts/check-vps-memory.sh
```

## Backup / reset dev

```bash
# Backup
docker compose exec postgres pg_dump -U avaso avaso_gateway > backup.sql

# Reset volume (xóa hết data)
docker compose down -v
docker compose up -d postgres redis
cargo run   # migrate + seed lại
```

## Production (systemd)

Trong `/etc/avaso-gateway/env`:

```bash
DATABASE_URL=postgres://USER:PASS@127.0.0.1:5432/avaso_gateway
REDIS_URL=redis://127.0.0.1:6379
```

PostgreSQL và Redis chạy service riêng (hoặc managed DB). **Không** dùng volume SQLite cũ.
