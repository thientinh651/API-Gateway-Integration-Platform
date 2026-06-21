#!/usr/bin/env bash
# Benchmark — Routing + JWT validation overhead (NFR đồ án).
#
# Baseline (no auth):
#   export BENCH_URL="http://127.0.0.1:3000/health"
#   ./scripts/benchmark-gateway.sh
#
# Data-plane JWT (cần OAuth client):
#   source ./scripts/ensure-bench-credentials.sh
#   export BENCH_URL="http://127.0.0.1:3000/v1/api/get"
#   ./scripts/benchmark-gateway.sh

set -euo pipefail

BENCH_URL="${BENCH_URL:-http://127.0.0.1:3000/health}"
BENCH_REQUESTS="${BENCH_REQUESTS:-100}"
BENCH_CONCURRENCY="${BENCH_CONCURRENCY:-10}"
BENCH_DURATION="${BENCH_DURATION:-10s}"
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

fetch_jwt_token() {
  local base api_key secret
  base="${BENCH_BASE_URL:-${BENCH_URL%%/v1/api/*}}"
  base="${base:-http://127.0.0.1:3000}"
  api_key="${BENCH_API_KEY:?Set BENCH_API_KEY (client_id)}"
  secret="${BENCH_SECRET_KEY:?Set BENCH_SECRET_KEY}"
  curl -sS -X POST "$base/api/oauth/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d "grant_type=client_credentials&client_id=${api_key}&client_secret=${secret}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))"
}

bench_jwt_curl_loop() {
  local base_url="$1"
  local base_path="${base_url#*://}"
  base_path="/${base_path#*/}"
  base_path="${base_path%%\?*}"
  local host="${base_url%%//*}"
  host="${host#*://}"
  local scheme="${base_url%%://*}"
  local ok=0 fail=0 total_ms=0
  local tmp token
  tmp="$(mktemp)"
  token="$(fetch_jwt_token)"
  [[ -n "$token" ]] || { echo "Failed to fetch JWT" | tee -a "$OUT_FILE"; return 1; }

  echo "Tool: JWT curl e2e (token refresh once per loop)" | tee -a "$OUT_FILE"
  set +e
  for ((i = 1; i <= BENCH_REQUESTS; i++)); do
    req_path="${base_path}?bench=${i}"
    req_url="${scheme}://${host}${req_path}"
    curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' --max-time 15 \
      -H "Authorization: Bearer $token" \
      "$req_url" >>"$tmp" 2>/dev/null || echo "000 0" >>"$tmp"
  done
  set -e
  while read -r code t; do
    local ms
    ms=$(awk -v t="$t" 'BEGIN{printf "%.0f", t*1000}')
    if [[ "$code" =~ ^2 ]] || [[ "$code" == "429" ]] || [[ "$code" =~ ^50[234]$ ]]; then ok=$((ok + 1)); else fail=$((fail + 1)); fi
    total_ms=$((total_ms + ms))
  done <"$tmp"
  rm -f "$tmp"
  local avg=$((total_ms / (ok + fail + 1)))
  {
    echo "jwt_requests_ok=$ok"
    echo "jwt_requests_fail=$fail"
    echo "jwt_avg_latency_ms=$avg"
  } | tee -a "$OUT_FILE"
}

CURL_EXTRA_HEADERS=()
if [[ "$BENCH_URL" == *"/v1/api"* ]]; then
  if [[ -z "${BENCH_ACCESS_TOKEN:-}" && -n "${BENCH_API_KEY:-}" && -n "${BENCH_SECRET_KEY:-}" ]]; then
    BENCH_ACCESS_TOKEN="$(fetch_jwt_token)"
    export BENCH_ACCESS_TOKEN
  fi
  if [[ -n "${BENCH_ACCESS_TOKEN:-}" ]]; then
    CURL_EXTRA_HEADERS=(-H "Authorization: Bearer $BENCH_ACCESS_TOKEN")
  fi
fi

RSS_BEFORE="$(gateway_rss_kb)"

{
  echo "benchmark_at=$(date -Is)"
  echo "url=$BENCH_URL"
  echo "requests=$BENCH_REQUESTS"
  echo "concurrency=$BENCH_CONCURRENCY"
  echo "duration=$BENCH_DURATION"
  echo "auth=$([[ ${#CURL_EXTRA_HEADERS[@]} -gt 0 ]] && echo jwt || echo none)"
  echo "rss_kb_before=$RSS_BEFORE"
  echo "---"
} | tee "$OUT_FILE"

if command -v wrk >/dev/null 2>&1; then
  echo "Tool: wrk" | tee -a "$OUT_FILE"
  if [[ "$BENCH_URL" == *"/v1/api"* && -n "${BENCH_ACCESS_TOKEN:-}" ]]; then
    export BENCH_JWT_PATH="${BENCH_JWT_PATH:-${BENCH_URL#*://}}"
    BENCH_JWT_PATH="/${BENCH_JWT_PATH#*/}"
    BENCH_JWT_PATH="${BENCH_JWT_PATH%%\?*}"
    export BENCH_JWT_PATH BENCH_ACCESS_TOKEN
    wrk -t"$BENCH_CONCURRENCY" -c"$BENCH_CONCURRENCY" -d"$BENCH_DURATION" --latency \
      -s "$(dirname "$0")/wrk-jwt.lua" "$BENCH_URL" 2>&1 | tee -a "$OUT_FILE" || true
    bench_jwt_curl_loop "$BENCH_URL"
  elif ((${#CURL_EXTRA_HEADERS[@]} > 0)); then
    wrk -t"$BENCH_CONCURRENCY" -c"$BENCH_CONCURRENCY" -d"$BENCH_DURATION" --latency \
      "${CURL_EXTRA_HEADERS[@]}" "$BENCH_URL" 2>&1 | tee -a "$OUT_FILE"
  else
    wrk -t"$BENCH_CONCURRENCY" -c"$BENCH_CONCURRENCY" -d"$BENCH_DURATION" --latency "$BENCH_URL" 2>&1 | tee -a "$OUT_FILE"
  fi
elif command -v oha >/dev/null 2>&1; then
  echo "Tool: oha" | tee -a "$OUT_FILE"
  oha -n "$BENCH_REQUESTS" -c "$BENCH_CONCURRENCY" "${CURL_EXTRA_HEADERS[@]}" "$BENCH_URL" 2>&1 | tee -a "$OUT_FILE"
elif command -v hey >/dev/null 2>&1; then
  echo "Tool: hey" | tee -a "$OUT_FILE"
  hey -n "$BENCH_REQUESTS" -c "$BENCH_CONCURRENCY" "${CURL_EXTRA_HEADERS[@]}" "$BENCH_URL" 2>&1 | tee -a "$OUT_FILE"
else
  echo "Tool: curl loop (cài wrk/oha/hey để histogram chuẩn hơn)" | tee -a "$OUT_FILE"
  OK=0
  FAIL=0
  TOTAL_MS=0
  for ((i = 1; i <= BENCH_REQUESTS; i++)); do
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
METRICS_BASE="${BENCH_URL%%/v1/api/*}"
{
  echo "---"
  echo "rss_kb_after=$RSS_AFTER"
  echo "rss_delta_kb=$((RSS_AFTER - RSS_BEFORE))"
  echo "--- metrics json ---"
  curl -sS "${METRICS_BASE:-http://127.0.0.1:3000}/metrics" 2>/dev/null | head -20 || true
  echo "--- metrics prometheus ---"
  curl -sS "${METRICS_BASE:-http://127.0.0.1:3000}/metrics?format=prometheus" 2>/dev/null | head -20 || true
} | tee -a "$OUT_FILE"

echo ""
echo "Saved: $OUT_FILE"
