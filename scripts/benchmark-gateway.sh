#!/usr/bin/env bash
# Benchmark nhẹ — chứng minh NFR đồ án (latency + RSS). Không so WSO2.
#
#   export BENCH_URL="http://127.0.0.1:3000/health"
#   export BENCH_REQUESTS=200
#   ./scripts/benchmark-gateway.sh
#
# Data-plane (cần key):
#   export BENCH_URL="http://127.0.0.1:3000/v1/api/get"
#   export BENCH_API_KEY=avaso_pk_...
#   export BENCH_SECRET_KEY=avaso_sk_...

set -euo pipefail

BENCH_URL="${BENCH_URL:-http://127.0.0.1:3000/health}"
BENCH_REQUESTS="${BENCH_REQUESTS:-100}"
BENCH_CONCURRENCY="${BENCH_CONCURRENCY:-10}"
SERVICE_NAME="${SERVICE_NAME:-avaso-gateway}"
OUT_DIR="${OUT_DIR:-./data/benchmark}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$OUT_DIR/result-$TS.txt"

mkdir -p "$OUT_DIR"

gateway_rss_kb() {
  local pid
  pid="$(systemctl show -p MainPID --value "$SERVICE_NAME" 2>/dev/null | tr -d ' ' || true)"
  if [[ -n "$pid" && "$pid" != "0" ]]; then
    ps -o rss= -p "$pid" 2>/dev/null | tr -d ' '
  else
    pgrep -f 'avaso-gateway' | head -1 | xargs -I{} ps -o rss= -p {} 2>/dev/null | tr -d ' ' || echo "0"
  fi
}

sign_hmac_curl() {
  local method="${1:-GET}"
  local url="$2"
  local path="${url#*://}"
  path="/${path#*/}"
  path="${path%%\?*}"
  local ts api_key secret payload sig
  api_key="${BENCH_API_KEY:?Set BENCH_API_KEY}"
  secret="${BENCH_SECRET_KEY:?Set BENCH_SECRET_KEY}"
  ts="$(date +%s)"
  payload="${api_key}
${ts}
${method}
${path}
"
  sig="$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "$secret" | awk '{print $2}')"
  CURL_EXTRA_HEADERS=(
    -H "X-API-Key: $api_key"
    -H "X-Timestamp: $ts"
    -H "X-Signature: $sig"
  )
}

CURL_EXTRA_HEADERS=()
if [[ "$BENCH_URL" == *"/v1/api"* ]]; then
  sign_hmac_curl GET "$BENCH_URL"
fi

RSS_BEFORE="$(gateway_rss_kb)"

{
  echo "benchmark_at=$(date -Is)"
  echo "url=$BENCH_URL"
  echo "requests=$BENCH_REQUESTS"
  echo "concurrency=$BENCH_CONCURRENCY"
  echo "rss_kb_before=$RSS_BEFORE"
  echo "---"
} | tee "$OUT_FILE"

if command -v hey >/dev/null 2>&1; then
  echo "Tool: hey" | tee -a "$OUT_FILE"
  # shellcheck disable=SC2068
  hey -n "$BENCH_REQUESTS" -c "$BENCH_CONCURRENCY" "${CURL_EXTRA_HEADERS[@]}" "$BENCH_URL" 2>&1 | tee -a "$OUT_FILE"
else
  echo "Tool: curl loop (cài 'hey' để có histogram chuẩn hơn)" | tee -a "$OUT_FILE"
  OK=0
  FAIL=0
  TOTAL_MS=0
  for ((i = 1; i <= BENCH_REQUESTS; i++)); do
    # shellcheck disable=SC2068
    MS=$(curl -sS -o /dev/null -w '%{time_total}' "${CURL_EXTRA_HEADERS[@]}" "$BENCH_URL" 2>/dev/null | awk '{printf "%.0f", $1*1000}')
    TOTAL_MS=$((TOTAL_MS + MS))
    if [[ -n "$MS" ]]; then OK=$((OK + 1)); else FAIL=$((FAIL + 1)); fi
  done
  AVG=$((TOTAL_MS / (OK + 1)))
  {
    echo "requests_ok=$OK"
    echo "requests_fail=$FAIL"
    echo "avg_latency_ms=$AVG"
  } | tee -a "$OUT_FILE"
fi

RSS_AFTER="$(gateway_rss_kb)"
{
  echo "---"
  echo "rss_kb_after=$RSS_AFTER"
  echo "rss_delta_kb=$((RSS_AFTER - RSS_BEFORE))"
} | tee -a "$OUT_FILE"

echo ""
echo "Saved: $OUT_FILE"
echo "Metrics snapshot: curl -sS ${BENCH_URL%/v1/api/*}/metrics 2>/dev/null || curl -sS http://127.0.0.1:3000/metrics"
