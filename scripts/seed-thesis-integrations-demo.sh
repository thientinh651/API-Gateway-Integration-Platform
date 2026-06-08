#!/usr/bin/env bash
# Demo OAuth token (bảng integrations) — KHÔNG thay Client ID/Secret (integration_provider_configs).
# Chỉ dùng khi đã lưu Connected App trên Dashboard mà chưa kịp OAuth Connect thật.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_URL="${DATABASE_URL:-postgres://avaso:avaso_local_2026@127.0.0.1:5432/avaso_gateway}"
MASTER="${INTEGRATION_MASTER_KEY:-avaso-integration-key-change-in-prod-32b}"
BASE="${GATEWAY_BASE_URL:-http://127.0.0.1:3000}"

INTEGRATION_MASTER_KEY="$MASTER" DATABASE_URL="$DB_URL" python3 <<'PY'
import base64, hashlib, json, os, secrets, subprocess
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def enc(obj):
    key = hashlib.sha256(os.environ["INTEGRATION_MASTER_KEY"].encode()).digest()
    payload = json.dumps(obj).encode()
    nonce = secrets.token_bytes(12)
    return base64.b64encode(nonce + AESGCM(key).encrypt(nonce, payload, None)).decode()

db = os.environ["DATABASE_URL"]
sf = enc({
    "access_token": "demo-sf-access",
    "refresh_token": "demo-sf-refresh",
    "instance_url": "https://demo.salesforce.com",
    "token_type": "Bearer",
    "demo": True,
})
zoho = enc({
    "access_token": "demo-zoho-access",
    "refresh_token": "demo-zoho-refresh",
    "api_domain": "https://www.zohoapis.com",
    "portal_id": "thesis-demo-portal",
    "demo": True,
})
for provider, blob in [("salesforce", sf), ("zoho_projects", zoho)]:
    subprocess.check_call([
        "psql", db, "-c",
        f"UPDATE integrations SET status='connected', config_encrypted='{blob}', "
        f"last_error=NULL, last_sync_at=NOW(), updated_at=NOW() "
        f"WHERE tenant_id=1 AND provider='{provider}'"
    ])
print("Seeded demo tokens.")
PY

COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT
curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' -o /dev/null

echo "==> SF sync"
curl -sS -b "$COOKIE" -X POST "$BASE/api/integrations/salesforce/sync"
echo ""
echo "==> Zoho sync"
curl -sS -b "$COOKIE" -X POST "$BASE/api/integrations/zoho/sync"
echo ""
echo "==> SF test"
curl -sS -b "$COOKIE" "$BASE/api/integrations/salesforce/test"
echo ""
echo "==> Zoho test"
curl -sS -b "$COOKIE" "$BASE/api/integrations/zoho/test"
echo ""
echo "Done — Integrations connected (demo). Real OAuth: ./scripts/connect-integrations.sh"
