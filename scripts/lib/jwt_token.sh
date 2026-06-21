#!/usr/bin/env bash
# Shared OAuth2 client_credentials helpers for bash scripts.
# shellcheck shell=bash

jwt_gateway_base() {
  local raw="${GATEWAY_BASE:-${BENCH_BASE_URL:-http://127.0.0.1:3000}}"
  raw="${raw%/}"
  if [[ "$raw" == *"/v1/api"* ]]; then
    raw="${raw%%/v1/api*}"
  fi
  printf '%s' "$raw"
}

jwt_client_id() {
  printf '%s' "${API_KEY:-${BENCH_API_KEY:-${SOAK_API_KEY:-${TEST_CLIENT_ID:-}}}}"
}

jwt_client_secret() {
  printf '%s' "${SECRET_KEY:-${BENCH_SECRET_KEY:-${SOAK_SECRET_KEY:-${TEST_CLIENT_SECRET:-}}}}"
}

fetch_jwt_token() {
  local base client_id client_secret token
  base="$(jwt_gateway_base)"
  client_id="$(jwt_client_id)"
  client_secret="$(jwt_client_secret)"
  if [[ -z "$client_id" || -z "$client_secret" ]]; then
    echo "Missing OAuth client_id/client_secret (API_KEY + SECRET_KEY or BENCH_*)." >&2
    return 1
  fi
  token=$(curl -sS -X POST "$base/api/oauth/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d "grant_type=client_credentials&client_id=${client_id}&client_secret=${client_secret}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")
  if [[ -z "$token" ]]; then
    echo "Failed to fetch JWT from $base/api/oauth/token" >&2
    return 1
  fi
  printf '%s' "$token"
}

jwt_auth_header_args() {
  local token
  token="$(fetch_jwt_token)" || return 1
  printf '%s\n' "-H" "Authorization: Bearer ${token}"
}
