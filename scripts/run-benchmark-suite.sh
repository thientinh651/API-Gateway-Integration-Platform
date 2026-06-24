#!/usr/bin/env bash
# Chạy 3 benchmark: upstream_direct, health, jwt_full_pipeline.
# Yêu cầu: mock-upstream (8089), gateway (3000), wrk hoặc k6.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRED_FILE="${BENCH_CRED_FILE:-$ROOT/data/.bench-credentials}"
BASE="${BENCH_BASE_URL:-http://127.0.0.1:3000}"
MOCK="${MOCK_URL:-http://127.0.0.1:8089}"
VUS="${VUS:-50}"
DURATION="${DURATION:-30s}"
JWT_PATH="${JWT_PATH:-/v1/api/bench/get}"
OUT_DIR="${OUT_DIR:-$ROOT/k6/results}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/suite-$TS.txt"

mkdir -p "$OUT_DIR"

if [[ ! -f "$CRED_FILE" ]]; then
  BENCH_BASE_URL="$BASE" "$ROOT/scripts/ensure-bench-credentials.sh" >/dev/null
fi
# shellcheck disable=SC1090
source "$CRED_FILE"

MOCK_PID=""
cleanup() {
  [[ -n "$MOCK_PID" ]] && kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

if ! curl -sf "$MOCK/get" >/dev/null 2>&1; then
  python3 "$ROOT/scripts/mock-upstream.py" &
  MOCK_PID=$!
  for _ in $(seq 1 20); do
    curl -sf "$MOCK/get" >/dev/null 2>&1 && break
    sleep 0.2
  done
fi

gateway_rss_kb() {
  pgrep -f 'avaso-gateway' | head -1 | xargs -I{} ps -o rss= -p {} 2>/dev/null | tr -d ' ' || echo "0"
}

run_wrk() {
  local label="$1"
  local url="$2"
  shift 2
  {
    echo "=== $label ==="
    echo "url=$url"
    echo "vus=$VUS duration=$DURATION"
    wrk -t"$VUS" -c"$VUS" -d"$DURATION" --latency "$@" "$url" 2>&1 || true
    echo ""
  } | tee -a "$OUT"
}

run_k6() {
  local scenario="$1"
  local extra_env=("${@:2}")
  {
    echo "=== k6 scenario=$scenario ==="
    k6 run -e "BASE_URL=$BASE" -e "SCENARIO=$scenario" -e "VUS=$VUS" -e "DURATION=$DURATION" \
      "${extra_env[@]}" "$ROOT/k6/benchmark.js" 2>&1 || true
    echo ""
  } | tee -a "$OUT"
}

{
  echo "benchmark_suite_at=$(date -Is)"
  echo "base=$BASE mock=$MOCK jwt_path=$JWT_PATH"
  echo "rss_kb=$(gateway_rss_kb)"
  echo "---"
} | tee "$OUT"

if command -v k6 >/dev/null 2>&1; then
  k6 run -e "BASE_URL=$MOCK" -e "UPSTREAM_PATH=/get" -e "VUS=$VUS" -e "DURATION=$DURATION" \
    "$ROOT/k6/benchmark-direct.js" 2>&1 | tee -a "$OUT"
  run_k6 health
  run_k6 jwt \
    -e "CLIENT_ID=$BENCH_API_KEY" \
    -e "CLIENT_SECRET=$BENCH_SECRET_KEY" \
    -e "DATA_PLANE_PATH=$JWT_PATH"
else
  echo "k6 not found — using wrk" | tee -a "$OUT"
  run_wrk "A_upstream_direct" "$MOCK/get?bench="
  run_wrk "B_health" "$BASE/health"
  TOKEN=$(curl -sS -X POST "$BASE/api/oauth/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d "grant_type=client_credentials&client_id=${BENCH_API_KEY}&client_secret=${BENCH_SECRET_KEY}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")
  [[ -n "$TOKEN" ]] || { echo "JWT fetch failed" | tee -a "$OUT"; exit 1; }
  export BENCH_JWT_PATH="$JWT_PATH" BENCH_ACCESS_TOKEN="$TOKEN"
  run_wrk "C_jwt_full_pipeline" "$BASE$JWT_PATH" \
    -s "$ROOT/scripts/wrk-jwt.lua"
fi

echo "Saved: $OUT"
