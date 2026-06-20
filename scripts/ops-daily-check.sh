#!/usr/bin/env bash
# Kiểm tra nhanh hàng ngày — health, connector, sync log gần nhất.
set -euo pipefail

BASE="${GATEWAY_BASE_URL:-https://thientinh.io.vn}"
USER="${ADMIN_USER:-admin}"
PASS="${ADMIN_PASS:-}"
COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

fail=0

echo "==> Health"
if ! curl -sS -m 10 "$BASE/health" | python3 -m json.tool; then
  fail=1
fi

if [[ -z "$PASS" ]]; then
  echo ""
  echo "(Bỏ qua integrations — set ADMIN_PASS)"
  exit "$fail"
fi

curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" -o /dev/null

echo ""
echo "==> Connectors"
curl -sS -b "$COOKIE" "$BASE/api/integrations" | python3 -c "
import json,sys
for r in json.load(sys.stdin):
    print(f\"  {r.get('provider','?'):20} {r.get('status','?'):12} demo={r.get('is_demo',False)}\")
"

echo ""
echo "==> Sync logs (5 mới nhất)"
curl -sS -b "$COOKIE" "$BASE/api/integrations/sync-logs?limit=5" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  (endpoint hoặc quyền)"

echo ""
echo "==> Entity links count"
curl -sS -b "$COOKIE" "$BASE/api/integrations/entity-links" 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
items=d if isinstance(d,list) else d.get('items',d.get('links',[]))
print(f'  {len(items)} links')
" 2>/dev/null || true

exit "$fail"
