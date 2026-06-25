#!/usr/bin/env bash
# Tạo Client API Key loại salesforce (data plane /v1/api/sf/* + /v1/api/zoho/*).
# Sync worker dùng client cố định avaso_pk_sync_worker — gateway tự tạo lúc startup.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRED_FILE="${INTEGRATION_PROXY_CRED:-$ROOT/data/.integration-proxy-credentials}"
BASE="${GATEWAY_BASE_URL:-https://thientinh.io.vn}"
USER="${ADMIN_USER:-admin}"
PASS="${ADMIN_PASS:-}"

if [[ -f "$CRED_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CRED_FILE"
  if [[ -n "${API_KEY:-}" && -n "${SECRET_KEY:-}" ]]; then
    echo "Đã có key: $CRED_FILE"
    exit 0
  fi
fi

if [[ -z "$PASS" ]]; then
  echo "Set ADMIN_PASS hoặc tạo key thủ công trên Dashboard." >&2
  exit 1
fi

COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

code=$(curl -sS -o /tmp/int_login.json -w '%{http_code}' \
  -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" \
  -c "$COOKIE")
[[ "$code" == "200" ]] || { echo "Login failed HTTP $code" >&2; cat /tmp/int_login.json >&2; exit 1; }

resp=$(curl -sS -X POST "$BASE/api/client-keys" \
  -H 'Content-Type: application/json' \
  -b "$COOKIE" \
  -d '{"name":"integration-proxy-app","integration_type":"salesforce"}')

api_key=$(printf '%s' "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('api_key',''))")
secret_key=$(printf '%s' "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('secret_key',''))")

if [[ -z "$api_key" || -z "$secret_key" ]]; then
  echo "Create key failed: $resp" >&2
  exit 1
fi

mkdir -p "$(dirname "$CRED_FILE")"
cat >"$CRED_FILE" <<EOF
# Data plane SF/Zoho proxy — không commit
API_KEY=$api_key
SECRET_KEY=$secret_key
GATEWAY_BASE=$BASE
EOF
chmod 600 "$CRED_FILE"
echo "Saved: $CRED_FILE"
echo "Test: API_KEY=\$API_KEY SECRET_KEY=\$SECRET_KEY ./scripts/test-integration-proxy.sh"
