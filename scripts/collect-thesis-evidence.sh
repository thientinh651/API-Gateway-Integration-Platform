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

BENCH_REQUESTS=50 BENCH_CONCURRENCY=5 OUT_DIR="$OUT" \
  ./scripts/benchmark-gateway.sh 2>&1 | tee "$OUT/benchmark.log"

PID="$(systemctl show -p MainPID --value avaso-gateway 2>/dev/null | tr -d ' ' || true)"
if [[ -n "$PID" && "$PID" != "0" ]]; then
  ps -o pid,rss,vsz,%mem,cmd -p "$PID" | tee "$OUT/process.txt"
fi

cargo test --quiet 2>&1 | tail -5 | tee "$OUT/cargo-test-tail.log" || true

echo ""
echo "Done. Đính kèm thư mục $OUT vào báo cáo / slide NFR."
