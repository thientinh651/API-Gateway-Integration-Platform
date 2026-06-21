#!/usr/bin/env bash
# NFR-20: tải nhẹ 24h + ghi RSS định kỳ (phát hiện memory leak).
# Chạy trên VPS khi gateway đã bật qua systemd.
#
# Ví dụ:
#   export SOAK_URL="https://thientinh.io.vn/v1/api/get"
#   export SOAK_API_KEY="avaso_pk_..."
#   export SOAK_SECRET_KEY="avaso_sk_..."
#   ./scripts/nfr20-soak-test.sh
#
# Hoặc 1 giờ thử nhanh:
#   SOAK_HOURS=1 ./scripts/nfr20-soak-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/jwt_token.sh
source "$ROOT/scripts/lib/jwt_token.sh"

SOAK_URL="${SOAK_URL:-http://127.0.0.1:3000/health}"
SOAK_API_KEY="${SOAK_API_KEY:-$(jwt_client_id)}"
SOAK_SECRET_KEY="${SOAK_SECRET_KEY:-$(jwt_client_secret)}"
SOAK_AUTH="${SOAK_AUTH:-auto}"
SOAK_HOURS="${SOAK_HOURS:-24}"
INTERVAL_SEC="${INTERVAL_SEC:-5}"
MEM_LOG_EVERY_SEC="${MEM_LOG_EVERY_SEC:-300}"
LOG_DIR="${LOG_DIR:-./data/soak-nfr20}"
SERVICE_NAME="${SERVICE_NAME:-avaso-gateway}"

if [[ "$SOAK_AUTH" == "auto" ]]; then
  if [[ "$SOAK_URL" == *"/v1/api"* ]]; then
    SOAK_AUTH="jwt"
  else
    SOAK_AUTH="none"
  fi
fi

JWT_TOKEN=""
if [[ "$SOAK_AUTH" == "jwt" ]]; then
  if [[ -z "$SOAK_API_KEY" || -z "$SOAK_SECRET_KEY" ]]; then
    echo "Thiếu SOAK_API_KEY + SOAK_SECRET_KEY cho data-plane JWT." >&2
    exit 1
  fi
  JWT_TOKEN="$(fetch_jwt_token)"
fi

mkdir -p "$LOG_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
REQ_LOG="$LOG_DIR/requests-$TS.log"
MEM_LOG="$LOG_DIR/memory-$TS.csv"
META_LOG="$LOG_DIR/meta-$TS.txt"

END_EPOCH=$(( $(date +%s) + SOAK_HOURS * 3600 ))

{
  echo "started_at=$(date -Is)"
  echo "soak_url=$SOAK_URL"
  echo "soak_auth=$SOAK_AUTH"
  echo "soak_hours=$SOAK_HOURS"
  echo "interval_sec=$INTERVAL_SEC"
  echo "mem_log_every_sec=$MEM_LOG_EVERY_SEC"
  echo "service=$SERVICE_NAME"
} >"$META_LOG"

echo "timestamp,rss_kb,vsz_kb,pid" >"$MEM_LOG"

gateway_pid() {
  systemctl show -p MainPID --value "$SERVICE_NAME" 2>/dev/null | tr -d ' '
}

log_memory() {
  local pid rss vsz
  pid="$(gateway_pid)"
  if [[ -z "$pid" || "$pid" == "0" ]]; then
    echo "$(date -Is),,,no_pid" >>"$MEM_LOG"
    return
  fi
  read -r rss vsz _ < <(ps -o rss= -o vsz= -p "$pid" 2>/dev/null || echo " 0 0")
  echo "$(date -Is),${rss},${vsz},${pid}" >>"$MEM_LOG"
}

echo "NFR-20 soak: ${SOAK_HOURS}h, mỗi ${INTERVAL_SEC}s một request (auth=$SOAK_AUTH)."
echo "Request log: $REQ_LOG"
echo "Memory CSV:  $MEM_LOG"
echo "Dừng: Ctrl+C"

REQ_COUNT=0
ERR_COUNT=0
LAST_MEM=0

while [[ $(date +%s) -lt $END_EPOCH ]]; do
  NOW=$(date +%s)
  if (( NOW - LAST_MEM >= MEM_LOG_EVERY_SEC )); then
    log_memory
    LAST_MEM=$NOW
  fi

  CURL_ARGS=(--max-time 30)
  if [[ "$SOAK_AUTH" == "jwt" ]]; then
    CURL_ARGS+=(-H "Authorization: Bearer ${JWT_TOKEN}")
  fi

  CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
    "${CURL_ARGS[@]}" \
    "$SOAK_URL" 2>>"$REQ_LOG" || echo "000")

  REQ_COUNT=$((REQ_COUNT + 1))
  if [[ "$CODE" != "200" && "$CODE" != "429" ]]; then
    ERR_COUNT=$((ERR_COUNT + 1))
  fi
  echo "$(date -Is) http=$CODE total=$REQ_COUNT errors=$ERR_COUNT" >>"$REQ_LOG"

  sleep "$INTERVAL_SEC"
done

log_memory
echo "done_at=$(date -Is) requests=$REQ_COUNT errors=$ERR_COUNT" >>"$META_LOG"
echo "Hoàn tất. Xem $MEM_LOG — RSS ổn định (dao động nhẹ) = không leak rõ; tăng liên tục = cần điều tra."
