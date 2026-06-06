#!/usr/bin/env bash
# Kiểm tra RAM + Redis/PG trước demo — chạy trên Droplet.
set -euo pipefail

echo "=== RAM ==="
free -h

echo ""
echo "=== Top process (RSS) ==="
ps aux --sort=-%mem | head -8

redis_ping() {
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli ping 2>/dev/null
    redis-cli INFO memory 2>/dev/null | grep -E 'used_memory_human|maxmemory_human|maxmemory_policy' || true
    return
  fi
  if command -v docker >/dev/null 2>&1 && docker compose ps redis 2>/dev/null | grep -q Up; then
    docker compose exec -T redis redis-cli ping 2>/dev/null
    docker compose exec -T redis redis-cli INFO memory 2>/dev/null | grep -E 'used_memory_human|maxmemory_human|maxmemory_policy' || true
    return
  fi
  echo "redis-cli không có (cài: apt install redis-tools)"
}

pg_check() {
  if command -v psql >/dev/null 2>&1; then
    sudo -u postgres psql -tAc "SHOW shared_buffers;" 2>/dev/null \
      || psql "${DATABASE_URL:-postgres://avaso@127.0.0.1:5432/avaso_gateway}" -tAc "SHOW shared_buffers;" 2>/dev/null \
      || echo "PG không chạy"
    return
  fi
  if command -v docker >/dev/null 2>&1 && docker compose ps postgres 2>/dev/null | grep -q Up; then
    docker compose exec -T postgres psql -U avaso -d avaso_gateway -tAc "SHOW shared_buffers;" 2>/dev/null \
      || echo "PG container không phản hồi"
    return
  fi
  echo "psql không có (cài: apt install postgresql-client)"
}

echo ""
echo "=== Swap ==="
swapon --show 2>/dev/null || echo "Chưa có swap — chạy setup-vps-budget.sh"

echo ""
echo "=== Redis ==="
redis_ping

echo ""
echo "=== PostgreSQL ==="
pg_check

echo ""
echo "=== Gateway health ==="
curl -sf http://127.0.0.1:3000/health 2>/dev/null | python3 -m json.tool 2>/dev/null || \
  curl -sf https://thientinh.io.vn/health 2>/dev/null | python3 -m json.tool 2>/dev/null || \
  echo "Gateway health không gọi được"

echo ""
echo "Gợi ý: available Mem > 300MB trước demo; /health status = ok"
