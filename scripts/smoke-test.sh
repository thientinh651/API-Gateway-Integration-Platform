#!/usr/bin/env bash
# Smoke test — gateway phải đang chạy (mặc định :3000).
set -euo pipefail

BASE="${SMOKE_BASE_URL:-http://127.0.0.1:3000}"
USER="${SMOKE_ADMIN_USER:-admin}"
PASS="${SMOKE_ADMIN_PASS:-admin}"
COOKIE="$(mktemp)"

cleanup() { rm -f "$COOKIE"; }
trap cleanup EXIT

echo "==> health $BASE/health"
code=$(curl -sS -o /tmp/smoke_health.json -w '%{http_code}' "$BASE/health")
[[ "$code" == "200" ]] || { echo "FAIL health HTTP $code"; exit 1; }
grep -q '"status"' /tmp/smoke_health.json && echo "OK health"

echo "==> login POST $BASE/api/login"
code=$(curl -sS -o /tmp/smoke_login.json -w '%{http_code}' \
  -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" \
  -c "$COOKIE")
[[ "$code" == "200" ]] || { echo "FAIL login HTTP $code"; cat /tmp/smoke_login.json; exit 1; }
echo "OK login"

echo "==> GET $BASE/api/me"
code=$(curl -sS -o /tmp/smoke_me.json -w '%{http_code}' "$BASE/api/me" -b "$COOKIE")
[[ "$code" == "200" ]] || { echo "FAIL me HTTP $code"; exit 1; }
grep -q '"username"' /tmp/smoke_me.json && echo "OK me"

echo "==> GET $BASE/api/routes"
code=$(curl -sS -o /tmp/smoke_routes.json -w '%{http_code}' "$BASE/api/routes" -b "$COOKIE")
[[ "$code" == "200" ]] || { echo "FAIL routes HTTP $code"; exit 1; }
echo "OK routes"

echo "==> GET $BASE/api/audit-logs?limit=5"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/audit-logs?limit=5" -b "$COOKIE")
[[ "$code" == "200" ]] || { echo "FAIL audit-logs HTTP $code"; exit 1; }
echo "OK audit-logs"

echo "==> GET $BASE/metrics"
code=$(curl -sS -o /tmp/smoke_metrics.json -w '%{http_code}' "$BASE/metrics")
[[ "$code" == "200" ]] || { echo "FAIL metrics HTTP $code"; exit 1; }
grep -q 'data_plane' /tmp/smoke_metrics.json && echo "OK metrics"

echo ""
echo "All smoke checks passed."
