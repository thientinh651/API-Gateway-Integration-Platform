#!/usr/bin/env bash
# Cấu hình Brevo API (HTTPS 443 — hoạt động trên DigitalOcean khi SMTP bị chặn).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-/etc/avaso-gateway/env}"
BREVO_ENV="${BREVO_ENV:-/etc/avaso-gateway/brevo.env}"
SERVICE="${SERVICE:-avaso-gateway}"
FROM_EMAIL="${BREVO_FROM_EMAIL:-thientinh651@gmail.com}"
FROM_NAME="${BREVO_FROM_NAME:-AVASO Gateway}"

usage() {
  cat <<'EOF'
Usage:
  sudo ./scripts/setup-brevo.sh '<brevo-api-key>' '<verified-sender-email>'

Brevo dashboard:
  1. Transactional → Email API → Create API key
  2. Senders, Domains & Dedicated IPs → Senders → Add + verify email gửi đi
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Chạy với sudo." >&2
  exit 1
fi

API_KEY="${1:-${BREVO_API_KEY:-}}"
FROM="${2:-${FROM_EMAIL}}"
if [[ -z "$API_KEY" && -f /root/.avaso-brevo-key ]]; then
  API_KEY="$(tr -d ' \n\r' < /root/.avaso-brevo-key)"
fi
if [[ -z "$API_KEY" ]]; then
  read -rsp "Brevo API key (xkeysib-...): " API_KEY
  echo
fi

if [[ -z "$API_KEY" ]]; then
  echo "Thiếu API key." >&2
  usage
  exit 1
fi

mkdir -p "$(dirname "$BREVO_ENV")"
umask 077
cat > "$BREVO_ENV" <<EOF
BREVO_API_KEY=${API_KEY}
BREVO_FROM_EMAIL=${FROM}
BREVO_FROM_NAME=${FROM_NAME}
EOF
chmod 600 "$BREVO_ENV"

if [[ -f "$ENV_FILE" ]] && grep -q '^PASSWORD_RESET_DEV_LOG=1' "$ENV_FILE"; then
  sed -i 's/^PASSWORD_RESET_DEV_LOG=1/# PASSWORD_RESET_DEV_LOG=1  # tắt khi Brevo OK/' "$ENV_FILE"
fi

UNIT="/etc/systemd/system/${SERVICE}.service"
if ! grep -q 'brevo.env' "$UNIT" 2>/dev/null; then
  cp "$ROOT/deploy/systemd/avaso-gateway.service" "$UNIT"
fi

systemctl daemon-reload
systemctl restart "$SERVICE"

echo "Brevo env: $BREVO_ENV"
echo "Đã restart $SERVICE."

python3 - "$API_KEY" "$FROM" "$FROM_NAME" "$FROM" <<'PY'
import json, sys, urllib.request

api_key, from_email, from_name, to = sys.argv[1:5]
body = json.dumps({
    "sender": {"name": from_name, "email": from_email},
    "to": [{"email": to}],
    "subject": "AVASO Gateway — Brevo test",
    "textContent": "Brevo OK — OTP quên mật khẩu sẽ gửi qua email này.",
}).encode()
req = urllib.request.Request(
    "https://api.brevo.com/v3/smtp/email",
    data=body,
    headers={"api-key": api_key, "accept": "application/json", "content-type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as resp:
    print(f"Test mail OK (HTTP {resp.status}) → kiểm tra {to}")
PY
