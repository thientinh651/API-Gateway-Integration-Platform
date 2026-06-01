#!/usr/bin/env bash
# Demo DLQ: cần gateway chạy, route /v1/api → https://httpbin.org, DLQ bật trong Cài đặt.
# Usage: API_KEY=avaso_pk_... SECRET_KEY=avaso_sk_... ./scripts/demo-proxy-queue.sh
set -euo pipefail

API_KEY="${API_KEY:-}"
SECRET_KEY="${SECRET_KEY:-}"
BASE="${GATEWAY_BASE:-http://127.0.0.1:3000}"
PATH_SIGN="${PATH_SIGN:-/v1/api/status/503}"

if [[ -z "$API_KEY" || -z "$SECRET_KEY" ]]; then
  echo "Set API_KEY and SECRET_KEY (tạo ở Bảo mật & Auth)"
  exit 1
fi

METHOD=GET
TS=$(date +%s)
BODY=""
PAYLOAD="${API_KEY}
${TS}
${METHOD}
${PATH_SIGN}
${BODY}"

SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET_KEY" | awk '{print $2}')

echo "→ ${METHOD} ${BASE}${PATH_SIGN} (httpbin 503 → DLQ nếu bật Dead-letter queue)"
HTTP=$(curl -sS -o /tmp/dlq_demo_body.txt -w '%{http_code}' \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Timestamp: ${TS}" \
  -H "X-Signature: ${SIG}" \
  "${BASE}${PATH_SIGN}")
echo "HTTP ${HTTP}"
head -c 200 /tmp/dlq_demo_body.txt
echo
echo
echo "→ Kiểm tra queue (cần cookie admin hoặc mở UI Proxy Queue):"
echo "  Dashboard → Proxy Queue → Refresh"
