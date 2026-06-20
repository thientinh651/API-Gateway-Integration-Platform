#!/usr/bin/env bash
# Sau khi admin bấm Kết nối Zoho Projects trên Dashboard, script này:
# 1) In URL OAuth (nếu cần)
# 2) Chờ status = connected (poll)
# 3) Test portals → sync Zoho → Sync Now
set -euo pipefail

BASE="${SMOKE_BASE_URL:-http://127.0.0.1:3000}"
PUBLIC="${GATEWAY_PUBLIC_URL:-https://thientinh.io.vn}"
USER="${ADMIN_USERNAME:-admin}"
PASS="${ADMIN_PASSWORD:-}"
WAIT_SECS="${ZOHO_OAUTH_WAIT_SECS:-180}"
COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

if [[ -z "$PASS" && -f /etc/avaso-gateway/env ]]; then
  # shellcheck disable=SC1091
  source /etc/avaso-gateway/env
  PASS="${ADMIN_PASSWORD:-}"
  USER="${ADMIN_USERNAME:-admin}"
fi
[[ -n "$PASS" ]] || { echo "Set ADMIN_PASSWORD hoặc source /etc/avaso-gateway/env" >&2; exit 1; }

login() {
  local code
  code=$(curl -sS -o /tmp/zoho_sync_login.json -w '%{http_code}' -X POST "$BASE/api/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" -c "$COOKIE")
  [[ "$code" == "200" ]] || { echo "Login failed HTTP $code"; cat /tmp/zoho_sync_login.json; exit 1; }
}

zoho_status() {
  curl -sS "$BASE/api/integrations" -b "$COOKIE" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(next((r['status'] for r in d if r['provider']=='zoho_projects'), 'missing'))"
}

echo "==> Login admin"
login

echo "==> Zoho OAuth URL (mở tab mới khi đã login Dashboard $PUBLIC/integrations):"
REDIR=$(curl -sS -o /dev/null -w '%{redirect_url}' -b "$COOKIE" "$BASE/api/integrations/zoho/connect")
echo "$REDIR"
echo ""
echo "Hoàn tất Allow trên Zoho trong ${WAIT_SECS}s — script đang chờ..."

deadline=$((SECONDS + WAIT_SECS))
while (( SECONDS < deadline )); do
  st=$(zoho_status)
  if [[ "$st" == "connected" ]]; then
    echo "OK Zoho connected"
    break
  fi
  sleep 5
done

if [[ "$(zoho_status)" != "connected" ]]; then
  echo "TIMEOUT — chưa thấy zoho_projects connected. Hoàn tất OAuth rồi chạy lại script." >&2
  exit 1
fi

echo "==> Test portals"
curl -sS "$BASE/api/integrations/zoho/test" -b "$COOKIE" | python3 -m json.tool | head -20

echo "==> Sync Zoho snapshot"
curl -sS -X POST "$BASE/api/integrations/zoho/sync" -b "$COOKIE" | python3 -m json.tool

echo "==> Sync Now (SF → Zoho + PDF)"
curl -sS -X POST "$BASE/api/integrations/sync-now" -b "$COOKIE" | python3 -m json.tool

echo "==> Entity links"
curl -sS "$BASE/api/integrations/entity-links" -b "$COOKIE" | python3 -m json.tool

echo "DONE — xem Dashboard → Integrations"
