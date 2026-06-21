#!/usr/bin/env bash
# Mẫu benchmark data-plane JWT (unique query per request).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/jwt_token.sh
source "$ROOT/scripts/lib/jwt_token.sh"

BASE="${BENCH_BASE_URL:-http://127.0.0.1:3000}"
PATH_BASE="${BENCH_JWT_PATH:-/v1/api/get}"
REQUESTS="${BENCH_SAMPLE_REQUESTS:-20}"

TOKEN="$(fetch_jwt_token)"
echo "JWT sample: $REQUESTS requests → $BASE$PATH_BASE"

ok=0
fail=0
for i in $(seq 1 "$REQUESTS"); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${TOKEN}" \
    "${BASE}${PATH_BASE}?n=${i}")
  if [[ "$code" =~ ^2 ]]; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1))
    echo "HTTP $code on request $i" >&2
  fi
done

echo "OK=$ok FAIL=$fail"
[[ "$fail" -eq 0 ]]
