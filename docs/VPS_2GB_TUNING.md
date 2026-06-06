# Tune RAM — Droplet 2GB (demo không OOM)

## Cài một lệnh

```bash
sudo bash deploy/scripts/setup-vps-budget.sh
```

Cài PG + Redis + CLI, swap 1GB, migrate SQLite → PG, build release, restart. Trước demo: **đóng Cursor trên VPS** (~400MB RAM). Kiểm tra: `bash scripts/check-vps-memory.sh`

## Đã cấu hình trong repo

| Thành phần | Giới hạn | File |
|------------|----------|------|
| Redis | `maxmemory 128mb`, LRU | `deploy/redis/avaso.conf` |
| PostgreSQL | `shared_buffers 128MB`, `max_connections 40` | `deploy/postgres/avaso-2gb.conf` |
| Gateway pool | `PG_POOL_MAX=5` (mặc định) | `.env` / `db.rs` |
| Gateway systemd | `MemoryMax=384M` | `deploy/systemd/avaso-gateway.service` |
| Docker | memory limits per service | `docker-compose.yml` |

## Trên Droplet production (systemd)

```bash
cd /root/avaso-gateway   # hoặc đường dẫn repo
sudo bash deploy/scripts/apply-vps-2gb-tuning.sh
sudo cp deploy/systemd/avaso-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart avaso-gateway
bash scripts/check-vps-memory.sh
```

`/etc/avaso-gateway/env` cần:

```env
DATABASE_URL=postgres://avaso:...@127.0.0.1:5432/avaso_gateway
REDIS_URL=redis://127.0.0.1:6379
PG_POOL_MAX=5
```

## Docker

```bash
docker compose up -d
docker stats --no-stream
```

Postgres/Redis **không** bind `0.0.0.0` ra internet — chỉ `127.0.0.1` khi map port dev.

## Trước buổi demo

```bash
bash scripts/check-vps-memory.sh
# available > ~300MB
curl -sS http://127.0.0.1:3000/health
```

Tránh chạy đồng thời: `docker compose ha` + `cargo run` + build nặng trên cùng VPS.

## Nếu vẫn thiếu RAM

1. Tắt service không cần: `docker compose down` nếu dùng systemd native PG/Redis.
2. Managed PostgreSQL (tách DB khỏi 2GB).
3. Nâng Droplet 4GB.
