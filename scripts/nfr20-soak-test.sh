#!/usr/bin/env bash
# NFR-20: tải nhẹ 24h + ghi RSS định kỳ (phát hiện memory leak).
# Chạy trên VPS khi gateway đã bật qua systemd.
#
# Ví dụ:
#   export SOAK_URL="https://thientinh.io.vn/v1/api/get"
#   export SOAK_API_KEY="avaso_xxxx"
#   ./scripts/nfr20-soak-test.sh
#
# Hoặc 1 giờ thử nhanh:
#   SOAK_HOURS=1 ./scripts/nfr20-soak-test.sh

set -euo pipefail

SOAK_URL="${SOAK_URL:-https://thientinh.io.vn/v1/api/get}"
SOAK_API_KEY="${SOAK_API_KEY:-}"
SOAK_HOURS="${SOAK_HOURS:-24}"
INTERVAL_SEC="${INTERVAL_SEC:-5}"
MEM_LOG_EVERY_SEC="${MEM_LOG_EVERY_SEC:-300}"
LOG_DIR="${LOG_DIR:-./data/soak-nfr20}"
SERVICE_NAME="${SERVICE_NAME:-avaso-gateway}"

if [[ -z "$SOAK_API_KEY" ]]; then
  echo "Thiếu SOAK_API_KEY (client key avaso_...)." >&2
  exit 1
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

echo "NFR-20 soak: ${SOAK_HOURS}h, mỗi ${INTERVAL_SEC}s một request."
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

  CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "X-API-Key: $SOAK_API_KEY" \
    --max-time 30 \
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
