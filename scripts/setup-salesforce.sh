#!/usr/bin/env bash
# Ghi Connected App vào PostgreSQL (mã hóa) — tương đương admin lưu form Dashboard.
# Không ghi SF_* vào env; key/secret do người vận hành cung cấp lúc chạy script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="${SERVICE:-avaso-gateway}"
BASE_URL="${GATEWAY_BASE_URL:-http://127.0.0.1:3000}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"
REDIRECT_URI="${SF_REDIRECT_URI:-https://thientinh.io.vn/api/integrations/salesforce/callback}"
LOGIN_URL="${SF_LOGIN_URL:-https://login.salesforce.com}"

usage() {
  cat <<EOF
Usage:
  ./scripts/setup-salesforce.sh '<client_id>' '<client_secret>'
  CLIENT_ID='...' CLIENT_SECRET='...' ./scripts/setup-salesforce.sh

Khuyến nghị: Dashboard → Integrations → (+) Salesforce → nhập Client ID/Secret → Lưu.

Tạo Connected App (Salesforce Setup):
  1. Setup → App Manager → New Connected App
  2. Enable OAuth Settings
  3. Callback URL: ${REDIRECT_URI}
  4. Scopes: api, refresh_token, offline_access

Sau khi lưu config: Integrations → Connect (OAuth).
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

CLIENT_ID="${1:-${CLIENT_ID:-}}"
CLIENT_SECRET="${2:-${CLIENT_SECRET:-}}"

if [[ -z "$CLIENT_ID" ]]; then
  read -rp "SF Consumer Key (Client ID): " CLIENT_ID
fi
if [[ -z "$CLIENT_SECRET" ]]; then
  read -rsp "SF Consumer Secret: " CLIENT_SECRET
  echo
fi

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "Thiếu CLIENT_ID hoặc CLIENT_SECRET." >&2
  usage
  exit 1
fi

COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

login_code=$(curl -sS -o /tmp/sf_setup_login.json -w '%{http_code}' \
  -X POST "$BASE_URL/api/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" \
  -c "$COOKIE")
[[ "$login_code" == "200" ]] || {
  echo "Login failed HTTP $login_code" >&2
  cat /tmp/sf_setup_login.json >&2
  exit 1
}

export CID="$CLIENT_ID" CSEC="$CLIENT_SECRET" RURI="$REDIRECT_URI" LURL="$LOGIN_URL"
cfg_body=$(python3 - <<'PY'
import json, os
print(json.dumps({
  "client_id": os.environ["CID"],
  "client_secret": os.environ["CSEC"],
  "redirect_uri": os.environ["RURI"],
  "login_url": os.environ["LURL"],
}))
PY
)

put_code=$(curl -sS -o /tmp/sf_setup_cfg.json -w '%{http_code}' \
  -X PUT "$BASE_URL/api/integrations/salesforce/config" \
  -H 'Content-Type: application/json' \
  -b "$COOKIE" \
  -d "$cfg_body")
[[ "$put_code" == "200" ]] || {
  echo "PUT config failed HTTP $put_code" >&2
  cat /tmp/sf_setup_cfg.json >&2
  exit 1
}
echo "Saved encrypted SF config in PostgreSQL (integration_provider_configs)."

if [[ "$(id -u)" -eq 0 ]]; then
  systemctl restart "$SERVICE"
  sleep 2
fi

test_out=$(curl -sS -b "$COOKIE" "$BASE_URL/api/integrations/salesforce/test" || true)
echo "Test: $test_out"

if echo "$test_out" | grep -q 'not connected'; then
  echo ""
  echo "OK — config đã lưu. Bước tiếp: OAuth Connect"
  echo "  ${BASE_URL%/}/ → Integrations → Salesforce → Connect"
elif echo "$test_out" | grep -q 'not configured'; then
  echo "WARN: gateway chưa thấy config — kiểm tra DB / restart service." >&2
  exit 1
else
  echo "Salesforce provider ready."
fi
