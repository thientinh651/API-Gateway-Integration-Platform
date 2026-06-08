#!/usr/bin/env bash
# Gom chứng cứ đồ án: smoke + benchmark health + RSS + metrics JSON.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="$ROOT/data/thesis-evidence/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

echo "==> Output: $OUT"

{
  echo "collected_at=$(date -Is)"
  echo "hostname=$(hostname)"
  uname -a
} >"$OUT/meta.txt"

./scripts/smoke-test.sh 2>&1 | tee "$OUT/smoke.log"

curl -sS http://127.0.0.1:3000/health | tee "$OUT/health.json"
echo "" | tee -a "$OUT/health.json"
curl -sS http://127.0.0.1:3000/metrics | tee "$OUT/metrics.json"
echo "" | tee -a "$OUT/metrics.json"
curl -sS 'http://127.0.0.1:3000/metrics?format=prometheus' | tee "$OUT/metrics-prometheus.txt"
echo "" | tee -a "$OUT/metrics-prometheus.txt"

echo "==> wrk health (30s)" | tee "$OUT/benchmark-wrk-health.log"
wrk -t4 -c50 -d30s --latency http://127.0.0.1:3000/health 2>&1 | tee -a "$OUT/benchmark-wrk-health.log" || true

./scripts/ensure-bench-credentials.sh 2>&1 | tee "$OUT/bench-credentials.log" || true
if [[ -f "$ROOT/data/.bench-credentials" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/data/.bench-credentials"
  set +a
  echo "==> wrk data-plane HMAC (30s)" | tee "$OUT/benchmark-wrk-dataplane.log"
  export BENCH_URL="http://127.0.0.1:3000/v1/api/get"
  export BENCH_API_KEY BENCH_SECRET_KEY
  export BENCH_REQUESTS=30
  export BENCH_CONCURRENCY=10
  export BENCH_DURATION=15s
  ./scripts/benchmark-gateway.sh 2>&1 | tee -a "$OUT/benchmark-wrk-dataplane.log" || true
  BENCH_REQUESTS=30 ./scripts/bench-signed-sample.sh 2>&1 | tee "$OUT/benchmark-signed-sample.log" || true
fi

curl -sS -b /tmp/ev_cookie -c /tmp/ev_cookie -X POST http://127.0.0.1:3000/api/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' -o /dev/null 2>/dev/null || true
./scripts/test-integrations.sh 2>&1 | tee "$OUT/integrations-status.log" || true

BENCH_REQUESTS=50 BENCH_CONCURRENCY=5 OUT_DIR="$OUT" \
  ./scripts/benchmark-gateway.sh 2>&1 | tee "$OUT/benchmark-curl.log"

PID="$(systemctl show -p MainPID --value avaso-gateway 2>/dev/null | tr -d ' ' || true)"
if [[ -n "$PID" && "$PID" != "0" ]]; then
  ps -o pid,rss,vsz,%mem,cmd -p "$PID" | tee "$OUT/process.txt"
fi

cargo test --quiet 2>&1 | tail -5 | tee "$OUT/cargo-test-tail.log" || true

echo ""
echo "Done. Đính kèm thư mục $OUT vào báo cáo / slide NFR."
