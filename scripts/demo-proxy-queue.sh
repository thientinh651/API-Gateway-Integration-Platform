#!/usr/bin/env bash
# Demo DLQ: cần gateway chạy, route /v1/api → https://httpbin.org, DLQ bật trong Cài đặt.
# Usage: API_KEY=avaso_cid_... SECRET_KEY=avaso_csec_... ./scripts/demo-proxy-queue.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/jwt_token.sh
source "$ROOT/scripts/lib/jwt_token.sh"

API_KEY="${API_KEY:-$(jwt_client_id)}"
SECRET_KEY="${SECRET_KEY:-$(jwt_client_secret)}"
BASE="${GATEWAY_BASE:-http://127.0.0.1:3000}"
PATH_SIGN="${PATH_SIGN:-/v1/api/status/503}"

if [[ -z "$API_KEY" || -z "$SECRET_KEY" ]]; then
  echo "Set API_KEY and SECRET_KEY (OAuth client từ Client Registry)"
  exit 1
fi

TOKEN="$(fetch_jwt_token)"
METHOD=GET

echo "→ ${METHOD} ${BASE}${PATH_SIGN} (httpbin 503 → DLQ nếu bật Dead-letter queue)"
HTTP=$(curl -sS -o /tmp/dlq_demo_body.txt -w '%{http_code}' \
  -H "Authorization: Bearer ${TOKEN}" \
  "${BASE}${PATH_SIGN}")
echo "HTTP ${HTTP}"
head -c 200 /tmp/dlq_demo_body.txt
echo
echo
echo "→ Kiểm tra queue (Dashboard → Proxy Queue → Refresh)"
