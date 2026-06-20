#!/usr/bin/env bash
# Cấu hình on-prem thực tế: tắt đăng ký công khai, bật sync nền, ghi chú ngưỡng deal.
# Chạy trên VPS: sudo ./scripts/setup-practical-onprem.sh [sf-dev|vn-prod]
set -euo pipefail

PROFILE="${1:-sf-dev}"
ENV_FILE="${AVASO_ENV_FILE:-/etc/avaso-gateway/env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Không thấy $ENV_FILE — copy deploy/systemd/env.example trước." >&2
  exit 1
fi

case "$PROFILE" in
  sf-dev)
    MIN_DEAL=250000
    MIN_NOTE="# SF Developer Edition (USD sample Closed Won ~250k+)"
    ;;
  vn-prod)
    MIN_DEAL=50000000
    MIN_NOTE="# VNĐ — deal VIP thực tế (docs/BAN_VE_HE_THONG.md §5)"
    ;;
  *)
    echo "Profile: sf-dev | vn-prod" >&2
    exit 1
    ;;
esac

backup="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "$ENV_FILE" "$backup"
echo "Backup: $backup"

python3 - "$ENV_FILE" "$MIN_DEAL" "$MIN_NOTE" <<'PY'
import re, sys
path, min_deal, min_note = sys.argv[1:4]
text = open(path).read()

def drop_line(key: str, s: str) -> str:
    return re.sub(rf"^.*{re.escape(key)}=.*\n", "", s, flags=re.M)

# Tắt đăng ký Viewer công khai
text = drop_line("ALLOW_VIEWER_REGISTRATION", text)

def set_kv(key: str, val: str, s: str) -> str:
    s = drop_line(key, s)
    return s.rstrip() + f"\n{key}={val}\n"

text = set_kv("INTEGRATION_SYNC_INTERVAL_MINS", "15", text)
text = set_kv("INTEGRATION_MIN_DEAL_AMOUNT", str(min_deal), text)
text = drop_line("INTEGRATION_MIN_DEAL_AMOUNT_NOTE", text)
text = text.rstrip() + f"\n{min_note}\n"

if "DEPLOYMENT_MODE=" not in text:
    text = text.rstrip() + "\n# DEPLOYMENT_MODE=on_prem\n"

open(path, "w").write(text)
print(f"OK env: sync=15m, min_deal={min_deal}, viewer_registration=OFF")
PY

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet avaso-gateway 2>/dev/null; then
  systemctl restart avaso-gateway
  echo "Restarted avaso-gateway"
  sleep 2
  systemctl is-active avaso-gateway && echo "Service: active"
fi

echo ""
echo "Tiếp: sudo ./scripts/ensure-integration-proxy-key.sh"
echo "Runbook: docs/VAN_HANH.md"
