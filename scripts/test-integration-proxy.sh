#!/usr/bin/env bash
# Test data-plane proxy: /v1/api/sf/* và /v1/api/zoho/*
# Cần: API_KEY, SECRET_KEY (+ OAuth SF/Zoho connected trên Dashboard)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/jwt_token.sh
source "$ROOT/scripts/lib/jwt_token.sh"

BASE="${GATEWAY_BASE:-https://thientinh.io.vn}"
BASE="${BASE%/}"
API_KEY="${API_KEY:-$(jwt_client_id)}"
SECRET_KEY="${SECRET_KEY:-$(jwt_client_secret)}"

if [[ -z "$API_KEY" || -z "$SECRET_KEY" ]]; then
  echo "Usage: API_KEY=avaso_cid_... SECRET_KEY=avaso_csec_... $0" >&2
  echo "Optional: GATEWAY_BASE=https://thientinh.io.vn" >&2
  exit 1
fi

TOKEN="$(fetch_jwt_token)"

call_proxy() {
  local label="$1"
  local method="$2"
  local path="$3"
  local body="${4:-}"
  echo ""
  echo "==> $label"
  echo "    $method $path"
  local code
  if [[ "$method" == "GET" ]]; then
    code=$(curl -sS -o /tmp/proxy_body.json -w '%{http_code}' \
      "$BASE$path" \
      -H "Authorization: Bearer $TOKEN")
  else
    code=$(curl -sS -o /tmp/proxy_body.json -w '%{http_code}' \
      -X "$method" "$BASE$path" \
      -H "Authorization: Bearer $TOKEN" \
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
  echo "FAIL — kiểm tra OAuth client JWT, OAuth Integrations" >&2
  exit 1
fi
