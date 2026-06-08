#!/usr/bin/env bash
# Kiểm tra trạng thái tích hợp SF + Zoho (admin API).
set -euo pipefail

BASE="${GATEWAY_BASE_URL:-http://127.0.0.1:3000}"
USER="${ADMIN_USER:-admin}"
PASS="${ADMIN_PASS:-admin}"
COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" -o /dev/null

mask_cfg() {
  python3 -c "
import json, sys
def mask_id(v):
    v = (v or '').strip()
    if len(v) <= 10:
        return v or '(chưa nhập)'
    return v[:8] + '…' + v[-4:]
d = json.load(sys.stdin)
for k in ('client_id',):
    if k in d:
        d[k] = mask_id(d.get(k))
json.dump(d, sys.stdout, indent=2, ensure_ascii=False)
print()
"
}

echo "==> Integrations list"
curl -sS -b "$COOKIE" "$BASE/api/integrations" | python3 -m json.tool

echo ""
echo "==> SF config (client_id masked)"
curl -sS -b "$COOKIE" "$BASE/api/integrations/salesforce/config" | mask_cfg

echo ""
echo "==> SF test"
curl -sS -b "$COOKIE" "$BASE/api/integrations/salesforce/test"
echo ""

echo ""
echo "==> Zoho config (client_id masked)"
curl -sS -b "$COOKIE" "$BASE/api/integrations/zoho/config" | mask_cfg 2>/dev/null || true

echo ""
echo "==> Zoho test"
curl -sS -b "$COOKIE" "$BASE/api/integrations/zoho/test"
echo ""

echo ""
echo "OAuth Connect URLs (mở trình duyệt khi đã login admin):"
echo "  $BASE/api/integrations/salesforce/connect"
echo "  $BASE/api/integrations/zoho/connect"
