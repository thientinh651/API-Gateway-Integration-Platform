#!/usr/bin/env bash
# In ra URL OAuth Zoho/SF (đã login admin) — mở trình duyệt để hoàn tất Connect.
set -euo pipefail

BASE="${GATEWAY_BASE_URL:-https://thientinh.io.vn}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"
OUT="${1:-./data/integration-oauth-urls.txt}"

COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

login_code=$(curl -sS -o /tmp/conn_login.json -w '%{http_code}' \
  -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" \
  -c "$COOKIE")
[[ "$login_code" == "200" ]] || {
  echo "Login failed HTTP $login_code" >&2
  cat /tmp/conn_login.json >&2
  exit 1
}

mkdir -p "$(dirname "$OUT")"
{
  echo "generated_at=$(date -Is)"
  echo "gateway=$BASE"
  echo ""
} >"$OUT"

redirect_url() {
  local path="$1"
  curl -sS -D - -o /dev/null -b "$COOKIE" "${BASE}${path}" 2>/dev/null \
    | grep -i '^location:' | head -1 | sed -E 's/^[Ll][Oo][Cc][Aa][Tt][Ii][Oo][Nn]:[[:space:]]*//' | tr -d '\r'
}

echo "==> Zoho OAuth" | tee -a "$OUT"
ZOHO_URL=$(redirect_url "/api/integrations/zoho/connect" || true)
if [[ -n "$ZOHO_URL" ]]; then
  echo "Zoho Connect URL:" | tee -a "$OUT"
  echo "$ZOHO_URL" | tee -a "$OUT"
else
  echo "Zoho: không lấy được redirect (nhập Client ID/Secret trên Dashboard → Integrations)" | tee -a "$OUT"
fi

echo "" | tee -a "$OUT"
echo "==> Salesforce OAuth" | tee -a "$OUT"
SF_CLIENT_ID=$(curl -sS -b "$COOKIE" "${BASE}/api/integrations/salesforce/config" \
  | python3 -c "import sys,json; print((json.load(sys.stdin).get('client_id') or '').strip())" 2>/dev/null || true)
if [[ -z "$SF_CLIENT_ID" || "$SF_CLIENT_ID" == "test-id" ]]; then
  echo "Salesforce: chưa có Connected App thật — Dashboard → Integrations → nhập Client ID/Secret → Lưu" | tee -a "$OUT"
  echo "(Bỏ qua /connect để không reset trạng thái demo)" | tee -a "$OUT"
else
  SF_URL=$(redirect_url "/api/integrations/salesforce/connect" || true)
  if [[ -n "$SF_URL" ]]; then
    echo "Salesforce Connect URL:" | tee -a "$OUT"
    echo "$SF_URL" | tee -a "$OUT"
  else
    SF_BODY=$(curl -sS -b "$COOKIE" "${BASE}/api/integrations/salesforce/connect" 2>/dev/null || true)
    echo "Salesforce: không lấy được redirect" | tee -a "$OUT"
    echo "Response: $SF_BODY" | tee -a "$OUT"
  fi
fi

echo "" | tee -a "$OUT"
echo "Dashboard: ${BASE}/integrations" | tee -a "$OUT"
echo "" 
echo "Saved: $OUT"
echo "Mở Zoho URL trong browser → đăng nhập Zoho → Allow → redirect ?ok=zoho"
