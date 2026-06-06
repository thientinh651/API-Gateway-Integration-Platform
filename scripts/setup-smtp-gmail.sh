#!/usr/bin/env bash
# Cấu hình Gmail SMTP cho OTP quên mật khẩu (systemd EnvironmentFile).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-/etc/avaso-gateway/env}"
SMTP_ENV="${SMTP_ENV:-/etc/avaso-gateway/smtp.env}"
SERVICE="${SERVICE:-avaso-gateway}"
SMTP_USER="${SMTP_USER:-thientinh651@gmail.com}"

usage() {
  cat <<'EOF'
Usage:
  sudo ./scripts/setup-smtp-gmail.sh '<gmail-app-password>'
  SMTP_PASS='...' sudo ./scripts/setup-smtp-gmail.sh

Gmail: bật 2FA → https://myaccount.google.com/apppasswords
App Password 16 ký tự (có hoặc không dấu cách).
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

SMTP_PASS="${1:-${SMTP_PASS:-}}"
if [[ -z "$SMTP_PASS" && -f /root/.avaso-smtp-pass ]]; then
  SMTP_PASS="$(tr -d ' \n\r' < /root/.avaso-smtp-pass)"
fi
if [[ -z "$SMTP_PASS" ]]; then
  read -rsp "Gmail App Password cho ${SMTP_USER}: " SMTP_PASS
  echo
fi
SMTP_PASS="${SMTP_PASS// /}"

if [[ -z "$SMTP_PASS" ]]; then
  echo "Thiếu SMTP_PASS." >&2
  usage
  exit 1
fi

mkdir -p "$(dirname "$SMTP_ENV")"
umask 077
cat > "$SMTP_ENV" <<EOF
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
SMTP_FROM=${SMTP_USER}
EOF
chmod 600 "$SMTP_ENV"

# Tắt dev log khi SMTP sẵn sàng
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^PASSWORD_RESET_DEV_LOG=1' "$ENV_FILE"; then
    sed -i 's/^PASSWORD_RESET_DEV_LOG=1/# PASSWORD_RESET_DEV_LOG=1  # tắt khi SMTP OK/' "$ENV_FILE"
  fi
fi

# Đảm bảo systemd load smtp.env
UNIT="/etc/systemd/system/${SERVICE}.service"
if ! grep -q 'smtp.env' "$UNIT" 2>/dev/null; then
  cp "$ROOT/deploy/systemd/avaso-gateway.service" "$UNIT"
fi

systemctl daemon-reload
systemctl restart "$SERVICE"

echo "SMTP env: $SMTP_ENV"
echo "Đã restart $SERVICE."

# Gửi mail thử (Python, không cần build Rust)
python3 - "$SMTP_USER" "$SMTP_PASS" <<'PY'
import os, smtplib, sys
from email.message import EmailMessage

user, passwd = sys.argv[1], sys.argv[2]
msg = EmailMessage()
msg["Subject"] = "AVASO Gateway — SMTP test"
msg["From"] = user
msg["To"] = user
msg.set_content("SMTP OK — OTP quên mật khẩu sẽ gửi qua email này.")

with smtplib.SMTP("smtp.gmail.com", 587, timeout=30) as s:
    s.ehlo()
    s.starttls()
    s.ehlo()
    s.login(user, passwd)
    s.send_message(msg)
print(f"Test mail gửi tới {user} — kiểm tra hộp thư.")
PY
