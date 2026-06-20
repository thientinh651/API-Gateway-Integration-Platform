#!/usr/bin/env bash
# Test data-plane proxy: /v1/api/sf/* và /v1/api/zoho/*
# Cần: API_KEY, SECRET_KEY (+ OAuth SF/Zoho connected trên Dashboard)
set -euo pipefail

BASE="${GATEWAY_BASE:-https://thientinh.io.vn}"
BASE="${BASE%/}"
API_KEY="${API_KEY:-}"
SECRET_KEY="${SECRET_KEY:-}"

if [[ -z "$API_KEY" || -z "$SECRET_KEY" ]]; then
  echo "Usage: API_KEY=avaso_pk_... SECRET_KEY=avaso_sk_... $0" >&2
  echo "Optional: GATEWAY_BASE=https://thientinh.io.vn" >&2
  exit 1
fi

sign_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  python3 - "$API_KEY" "$SECRET_KEY" "$method" "$path" "$body" <<'PY'
import hashlib, hmac, os, sys, time
api, secret, method, path, body = sys.argv[1:6]
ts = str(int(time.time()))
payload = f"{api}\n{ts}\n{method.upper()}\n{path}\n{body}"
sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
print(ts)
print(sig)
PY
}

call_proxy() {
  local label="$1"
  local method="$2"
  local path="$3"
  local body="${4:-}"
  echo ""
  echo "==> $label"
  echo "    $method $path"
  mapfile -t signed < <(sign_request "$method" "$path" "$body")
  local ts="${signed[0]}"
  local sig="${signed[1]}"
  local code
  if [[ "$method" == "GET" ]]; then
    code=$(curl -sS -o /tmp/proxy_body.json -w '%{http_code}' \
      "$BASE$path" \
      -H "X-API-Key: $API_KEY" \
      -H "X-Timestamp: $ts" \
      -H "X-Signature: $sig")
  else
    code=$(curl -sS -o /tmp/proxy_body.json -w '%{http_code}' \
      -X "$method" "$BASE$path" \
      -H "X-API-Key: $API_KEY" \
      -H "X-Timestamp: $ts" \
      -H "X-Signature: $sig" \
      -H "Content-Type: application/json" \
      -d "$body")
  fi
  echo "    HTTP $code"
  head -c 500 /tmp/proxy_body.json
  echo ""
  [[ "$code" =~ ^2 ]] || return 1
}

fail=0
call_proxy "Salesforce API limits" GET "/v1/api/sf/services/data/v59.0/limits" || fail=1
call_proxy "Salesforce SOQL (5 Opp)" GET "/v1/api/sf/services/data/v59.0/query?q=SELECT+Id,Name,StageName+FROM+Opportunity+LIMIT+5" || fail=1
call_proxy "Zoho Projects portals" GET "/v1/api/zoho/api/v3/portals" || fail=1

if [[ "$fail" -eq 0 ]]; then
  echo ""
  echo "OK — integration proxy SF + Zoho"
else
  echo ""
  echo "FAIL — kiểm tra Client Key, HMAC, OAuth Integrations" >&2
  exit 1
fi
