#!/usr/bin/env bash
# Cài PG + Redis + swap + tune RAM trên Droplet ~2GB (một lệnh).
# Chạy: sudo bash deploy/scripts/setup-vps-budget.sh
set -euo pipefail

export PATH="/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="/etc/avaso-gateway/env"
PG_PASS="${AVASO_PG_PASS:-avaso_local_2026}"
SWAP_MB="${AVASO_SWAP_MB:-1024}"

echo "==> Gói: PostgreSQL, Redis, CLI"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql postgresql-client redis-server redis-tools sqlite3 curl

echo "==> Swap ${SWAP_MB}MB (chống OOM khi build/demo)"
if [[ "$(swapon --show | wc -l)" -eq 0 ]] && [[ ! -f /swapfile ]]; then
  fallocate -l "${SWAP_MB}M" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count="${SWAP_MB}"
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi
free -h

echo "==> PostgreSQL: user + database"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'avaso') THEN
    CREATE ROLE avaso LOGIN PASSWORD '${PG_PASS}';
  ELSE
    ALTER ROLE avaso WITH PASSWORD '${PG_PASS}';
  END IF;
END\$\$;
SELECT 'CREATE DATABASE avaso_gateway OWNER avaso'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'avaso_gateway')\gexec
GRANT ALL PRIVILEGES ON DATABASE avaso_gateway TO avaso;
SQL

echo "==> Tune RAM (Redis 128MB, PG shared_buffers 128MB)"
bash "$ROOT/deploy/scripts/apply-vps-2gb-tuning.sh"

echo "==> Env: DATABASE_URL + REDIS_URL"
install -d /etc/avaso-gateway
if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
fi
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT/deploy/systemd/env.example" "$ENV_FILE"
fi
# Giữ secret cũ; chỉ đổi URL DB/Redis
grep -v -E '^(DATABASE_URL|REDIS_URL|PG_POOL_MAX)=' "$ENV_FILE" > "${ENV_FILE}.tmp" || true
{
  echo "DATABASE_URL=postgres://avaso:${PG_PASS}@127.0.0.1:5432/avaso_gateway"
  echo "REDIS_URL=redis://127.0.0.1:6379"
  echo "PG_POOL_MAX=5"
  cat "${ENV_FILE}.tmp"
} > "$ENV_FILE"
rm -f "${ENV_FILE}.tmp"
chmod 600 "$ENV_FILE"

echo "==> systemd: MemoryMax + After postgres/redis"
cp "$ROOT/deploy/systemd/avaso-gateway.service" /etc/systemd/system/avaso-gateway.service
systemctl daemon-reload

echo "==> Build release (1 job — tiết kiệm RAM)"
systemctl stop avaso-gateway 2>/dev/null || true
cd "$ROOT"
CARGO_BUILD_JOBS=1 cargo build --release

echo "==> Schema PostgreSQL (sqlx migrate qua gateway)"
export DATABASE_URL="postgres://avaso:${PG_PASS}@127.0.0.1:5432/avaso_gateway"
export REDIS_URL="redis://127.0.0.1:6379"
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a
timeout 25 "$ROOT/target/release/avaso-gateway" 2>/dev/null || true

echo "==> Migrate dữ liệu SQLite → PostgreSQL (nếu có gateway.db)"
python3 "$ROOT/deploy/scripts/migrate-sqlite-to-postgres.py" || true

echo "==> Khởi động stack"
systemctl enable postgresql redis-server avaso-gateway
systemctl restart postgresql redis-server
systemctl restart avaso-gateway
sleep 2
systemctl is-active postgresql redis-server avaso-gateway

echo ""
bash "$ROOT/scripts/check-vps-memory.sh"
echo ""
echo "Xong. Đóng Cursor trên VPS khi demo để giải phóng ~400MB RAM."
