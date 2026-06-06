#!/usr/bin/env bash
# Áp tune RAM cho Redis + PostgreSQL trên Ubuntu VPS (~2GB).
# Chạy trên Droplet: sudo bash deploy/scripts/apply-vps-2gb-tuning.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "==> Redis: maxmemory 128mb, bind 127.0.0.1"
if command -v redis-server >/dev/null 2>&1; then
  install -d /etc/redis/redis.conf.d
  cp "$ROOT/deploy/redis/avaso.conf" /etc/redis/redis.conf.d/avaso-gateway.conf
  if ! grep -q 'redis.conf.d/avaso-gateway' /etc/redis/redis.conf 2>/dev/null; then
    echo 'include /etc/redis/redis.conf.d/avaso-gateway.conf' >> /etc/redis/redis.conf
  fi
  systemctl restart redis-server
  redis-cli ping
  redis-cli CONFIG GET maxmemory
else
  echo "    (bỏ qua — redis-server chưa cài; dùng Docker compose)"
fi

echo "==> PostgreSQL: shared_buffers 128MB, max_connections 40"
if command -v psql >/dev/null 2>&1; then
  PG_VER="$(psql -V | awk '{print $3}' | cut -d. -f1)"
  PG_CONF_D="/etc/postgresql/${PG_VER}/main/conf.d"
  install -d "$PG_CONF_D"
  cp "$ROOT/deploy/postgres/avaso-2gb.conf" "$PG_CONF_D/avaso-2gb.conf"
  systemctl restart "postgresql@${PG_VER}-main" 2>/dev/null || systemctl restart postgresql
  sudo -u postgres psql -c "SHOW shared_buffers;" 2>/dev/null || true
else
  echo "    (bỏ qua — postgresql chưa cài; dùng Docker compose)"
fi

echo "==> UFW: chỉ 22/80/443 (nếu ufw active)"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw deny 5432/tcp 2>/dev/null || true
  ufw deny 6379/tcp 2>/dev/null || true
  echo "    Đảm bảo 5432/6379 không public"
fi

echo "==> Xong. Kiểm tra: bash scripts/check-vps-memory.sh"
