#!/usr/bin/env bash
# Tạo/lấy client key HMAC cho benchmark + soak (lưu local, không commit).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRED_FILE="${BENCH_CRED_FILE:-$ROOT/data/.bench-credentials}"
BASE="${BENCH_BASE_URL:-http://127.0.0.1:3000}"
USER="${BENCH_ADMIN_USER:-admin}"
PASS="${BENCH_ADMIN_PASS:-admin}"

if [[ -f "$CRED_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CRED_FILE"
  if [[ -n "${BENCH_API_KEY:-}" && -n "${BENCH_SECRET_KEY:-}" ]]; then
    echo "Using existing credentials: $CRED_FILE"
    export BENCH_API_KEY BENCH_SECRET_KEY
    exit 0
  fi
fi

COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

code=$(curl -sS -o /tmp/bench_login.json -w '%{http_code}' \
  -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" \
  -c "$COOKIE")
[[ "$code" == "200" ]] || { echo "Login failed HTTP $code" >&2; cat /tmp/bench_login.json >&2; exit 1; }

resp=$(curl -sS -X POST "$BASE/api/client-keys" \
  -H 'Content-Type: application/json' \
  -b "$COOKIE" \
  -d '{"name":"thesis-bench-auto","integration_type":"app"}')

api_key=$(printf '%s' "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('api_key',''))")
secret_key=$(printf '%s' "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('secret_key',''))")

if [[ -z "$api_key" || -z "$secret_key" ]]; then
  echo "Create key failed: $resp" >&2
  exit 1
fi

mkdir -p "$(dirname "$CRED_FILE")"
cat >"$CRED_FILE" <<EOF
# Auto-generated for benchmark/soak — không commit
BENCH_API_KEY=$api_key
BENCH_SECRET_KEY=$secret_key
EOF
chmod 600 "$CRED_FILE"
export BENCH_API_KEY="$api_key"
export BENCH_SECRET_KEY="$secret_key"
echo "Saved: $CRED_FILE"
