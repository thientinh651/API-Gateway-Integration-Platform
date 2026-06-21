#!/usr/bin/env bash
# Build release + web/dist + restart systemd (production deploy).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="${SERVICE_NAME:-avaso-gateway}"

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
  echo "==> restart $SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
  sudo systemctl status "$SERVICE_NAME" --no-pager || true
else
  echo "WARN: systemctl not found — restart gateway process manually"
fi

echo ""
echo "Deploy done."
echo "Verify:"
echo "  curl -sS $SMOKE_BASE_URL/health"
echo "  python3 scripts/test_jwt_auth.py"
