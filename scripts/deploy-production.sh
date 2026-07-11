#!/usr/bin/env bash
# Build release + web/dist + restart systemd (production deploy).
# Tránh 502: stop sạch, đợi cổng 3000 trống, rồi start (không để process cũ chiếm port).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="${SERVICE_NAME:-avaso-gateway}"
LISTEN_PORT="${LISTEN_PORT:-3000}"

wait_port_free() {
  local i
  for i in $(seq 1 20); do
    if ! ss -tlnp 2>/dev/null | grep -q ":${LISTEN_PORT} "; then
      return 0
    fi
    sleep 0.5
  done
  echo "WARN: port ${LISTEN_PORT} still busy after stop — forcing leftover avaso-gateway"
  # Chỉ kill binary gateway, không đụng crepectl/cursor helpers
  pkill -x avaso-gateway 2>/dev/null || true
  sleep 1
  if ss -tlnp 2>/dev/null | grep -q ":${LISTEN_PORT} "; then
    echo "ERROR: port ${LISTEN_PORT} still in use:"
    ss -tlnp | grep ":${LISTEN_PORT} " || true
    return 1
  fi
}

echo "==> cargo build --release"
cd "$ROOT"
cargo build --release

echo "==> npm run build (web/dist)"
cd "$ROOT/web"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

if command -v systemctl >/dev/null 2>&1; then
  echo "==> stop ${SERVICE_NAME} (release port ${LISTEN_PORT})"
  sudo systemctl stop "$SERVICE_NAME" || true
  sudo systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true
  wait_port_free

  echo "==> start ${SERVICE_NAME}"
  sudo systemctl start "$SERVICE_NAME"
  sleep 2
  sudo systemctl status "$SERVICE_NAME" --no-pager || true

  if ! curl -sfS --connect-timeout 3 "http://127.0.0.1:${LISTEN_PORT}/health" >/dev/null; then
    echo "ERROR: health check failed after start"
    journalctl -u "$SERVICE_NAME" -n 30 --no-pager || true
    exit 1
  fi
  echo "==> health OK"
else
  echo "WARN: systemctl not found — restart gateway process manually"
fi

echo ""
echo "Deploy done."
echo "Verify:"
echo "  curl -sS http://127.0.0.1:${LISTEN_PORT}/health"
echo "  curl -sS \$SMOKE_BASE_URL/health"
echo "  python3 scripts/test_jwt_auth.py"
