#!/usr/bin/env bash
# Chẩn đoán + sửa 502 khi nginx không kết nối được avaso-gateway (:3000).
# Chạy: sudo bash deploy/fix-502.sh
set -euo pipefail

export PATH="/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="avaso-gateway"
HEALTH_URL="http://127.0.0.1:3000/health"
PING_URL="http://127.0.0.1:3000/api/ping"
REBUILD=0

log() { printf '==> %s\n' "$*"; }
ok() { printf 'OK  %s\n' "$*"; }
warn() { printf '!!  %s\n' "$*"; }
fail() { printf 'ERR %s\n' "$*" >&2; exit 1; }

run_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

gateway_healthy() {
  curl -sf --max-time 3 "$HEALTH_URL" | grep -q '"status":"ok"'
}

service_active() {
  systemctl is-active --quiet "$SERVICE"
}

ensure_unit() {
  if ! systemctl list-unit-files "$SERVICE.service" &>/dev/null; then
    fail "Chưa cài $SERVICE.service — xem deploy/systemd/README.md"
  fi
}

ensure_deps() {
  log "Kiểm tra PostgreSQL + Redis"
  for dep in postgresql redis-server; do
    if ! systemctl is-active --quiet "$dep" 2>/dev/null; then
      warn "$dep chưa chạy — đang start"
      run_root systemctl start "$dep"
    fi
  done
  ok "PostgreSQL + Redis"
}

recent_journal() {
  journalctl -u "$SERVICE" -n "${1:-40}" --no-pager 2>/dev/null || true
}

needs_rebuild() {
  recent_journal 60 | grep -q 'VersionMissing'
}

start_gateway() {
  log "Start $SERVICE"
  run_root systemctl start "$SERVICE"
  sleep 2
}

restart_gateway() {
  log "Restart $SERVICE"
  run_root systemctl restart "$SERVICE"
  sleep 2
}

rebuild_gateway() {
  log "Rebuild release (migration/binary lệch DB)"
  run_root systemctl stop "$SERVICE" 2>/dev/null || true
  cd "$ROOT"
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" cargo build --release
  REBUILD=1
  ok "Build xong: $ROOT/target/release/avaso-gateway"
}

fix_gateway() {
  if gateway_healthy; then
    ok "Gateway đã healthy — $HEALTH_URL"
    return 0
  fi

  if ! service_active; then
    warn "$SERVICE không chạy"
    start_gateway
    gateway_healthy && return 0
  else
    warn "$SERVICE active nhưng /health fail — restart"
    restart_gateway
    gateway_healthy && return 0
  fi

  if needs_rebuild; then
    warn "Phát hiện VersionMissing trong journal — rebuild"
    rebuild_gateway
    restart_gateway
    gateway_healthy && return 0
  fi

  # Thử rebuild một lần nếu vẫn crash ngay (exit 101)
  if ! service_active || ! gateway_healthy; then
    if recent_journal 20 | grep -qE 'panicked at|exit-code|status=101'; then
      warn "Gateway crash khi start — thử rebuild"
      rebuild_gateway
      restart_gateway
      gateway_healthy && return 0
    fi
  fi

  return 1
}

check_nginx() {
  log "Kiểm tra nginx"
  if ! systemctl is-active --quiet nginx 2>/dev/null; then
    warn "nginx không chạy — start"
    run_root systemctl start nginx
  fi
  if run_root nginx -t 2>&1; then
    run_root systemctl reload nginx
    ok "nginx reload"
  else
    warn "nginx -t fail — xem /var/log/nginx/error.log"
    run_root tail -20 /var/log/nginx/error.log 2>/dev/null || true
    return 1
  fi
}

print_status() {
  log "Trạng thái hiện tại"
  systemctl status "$SERVICE" --no-pager -l 2>/dev/null | head -15 || true
  echo "---"
  curl -sS --max-time 3 "$HEALTH_URL" 2>/dev/null || echo "(health không phản hồi)"
  echo ""
}

main() {
  log "Fix 502 — avaso-gateway @ 127.0.0.1:3000"
  ensure_unit
  ensure_deps

  if fix_gateway; then
    ok "Gateway healthy"
  else
    fail "Không sửa được gateway. Log gần nhất:\n$(recent_journal 30)"
  fi

  check_nginx || warn "nginx có vấn đề — gateway vẫn OK trên :3000"

  log "Xác nhận"
  curl -sS --max-time 3 "$HEALTH_URL"
  echo ""
  curl -sS --max-time 3 "$PING_URL"
  echo ""

  if [[ "$REBUILD" -eq 1 ]]; then
    ok "Đã rebuild + restart. Refresh trình duyệt."
  else
    ok "Xong. Refresh trình duyệt."
  fi
}

main "$@"
