#!/usr/bin/env bash
# Mẫu benchmark data-plane HMAC (replay-safe, unique query).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "$ROOT/data/.bench-credentials" ]] && set -a && source "$ROOT/data/.bench-credentials" && set +a
: "${BENCH_API_KEY:?}"
: "${BENCH_SECRET_KEY:?}"

BASE="${BENCH_BASE_URL:-http://127.0.0.1:3000}"
PATH_BASE="${BENCH_HMAC_PATH:-/v1/api/get}"
N="${BENCH_REQUESTS:-30}"

ok=0 fail=0 sum_ms=0

for ((i = 1; i <= N; i++)); do
  path="${PATH_BASE}?sample=${i}"
  ts="$(date +%s)"
  payload="${BENCH_API_KEY}
${ts}
GET
${path}
"
  sig="$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "$BENCH_SECRET_KEY" | awk '{print $2}')"
  line=$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' --max-time 20 \
    -H "X-API-Key: $BENCH_API_KEY" \
    -H "X-Timestamp: $ts" \
    -H "X-Signature: $sig" \
    "${BASE}${path}" 2>/dev/null || echo "000 0")
  code="${line%% *}"
  t="${line#* }"
  ms=$(awk -v t="$t" 'BEGIN{printf "%.0f", t*1000}')
  if [[ "$code" =~ ^2 ]] || [[ "$code" == "429" ]] || [[ "$code" =~ ^50[234]$ ]]; then ok=$((ok + 1)); else fail=$((fail + 1)); fi
  sum_ms=$((sum_ms + ms))
  echo "req=$i http=$code latency_ms=$ms"
done

avg=$((sum_ms / (ok + fail + 1)))
echo "---"
echo "signed_sample_ok=$ok"
echo "signed_sample_fail=$fail"
echo "signed_sample_avg_ms=$avg"
