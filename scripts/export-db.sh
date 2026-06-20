#!/usr/bin/env bash
# Xuất PostgreSQL ra script SQL cho giảng viên.
# Mặc định: DDL dictionary (18 bảng, khớp Excel) — không cần DB đang chạy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-schema}"   # schema | dump | data
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="${OUT_DIR:-$ROOT/exports/db}"
mkdir -p "$OUT_DIR"

load_database_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    return 0
  fi
  for env_file in "$ROOT/.env" /etc/avaso-gateway/env; do
    if [[ -f "$env_file" ]]; then
      # shellcheck disable=SC1090
      set -a
      source "$env_file"
      set +a
      if [[ -n "${DATABASE_URL:-}" ]]; then
        echo "==> DATABASE_URL từ $env_file"
        return 0
      fi
    fi
  done
}

run_pg_dump() {
  local outfile="$1"
  shift
  local -a extra=("$@")
  local tmp
  tmp="$(mktemp "${outfile}.XXXXXX")"

  cleanup() {
    rm -f "$tmp"
  }
  trap cleanup EXIT

  if command -v pg_dump >/dev/null 2>&1; then
    if pg_dump "$DATABASE_URL" "${extra[@]}" > "$tmp"; then
      :
    else
      echo "FAIL: pg_dump lỗi — kiểm tra DATABASE_URL và PostgreSQL đang chạy" >&2
      exit 1
    fi
  elif command -v docker >/dev/null 2>&1 && docker compose ps postgres 2>/dev/null | grep -q Up; then
    if docker compose exec -T postgres pg_dump -U avaso -d avaso_gateway "${extra[@]}" > "$tmp"; then
      :
    else
      echo "FAIL: docker compose exec pg_dump lỗi" >&2
      exit 1
    fi
  else
    echo "FAIL: cần pg_dump hoặc postgres container (docker compose up -d postgres)" >&2
    exit 1
  fi

  if [[ ! -s "$tmp" ]]; then
    echo "FAIL: file export rỗng" >&2
    exit 1
  fi

  mv "$tmp" "$outfile"
  trap - EXIT
}

export_schema_dict() {
  local outfile="$1"
  echo "==> Xuất schema dictionary (18 bảng, khớp Excel) → $outfile"
  python3 "$ROOT/scripts/generate_schema_sql.py" --style clean --out "$outfile"
}

case "$MODE" in
  schema)
    OUTFILE="$OUT_DIR/avaso_gateway_schema_${TIMESTAMP}.sql"
    export_schema_dict "$OUTFILE"
    LATEST="$OUT_DIR/avaso_gateway_schema_latest.sql"
    ;;
  dump)
    load_database_url
    if [[ -z "${DATABASE_URL:-}" ]]; then
      echo "FAIL: dump cần DATABASE_URL (.env hoặc /etc/avaso-gateway/env)" >&2
      exit 1
    fi
    OUTFILE="$OUT_DIR/avaso_gateway_dump_${TIMESTAMP}.sql"
    echo "==> Xuất pg_dump (schema + data thực tế) → $OUTFILE"
    run_pg_dump "$OUTFILE" \
      --no-owner --no-privileges \
      --inserts \
      --clean --if-exists
    LATEST="$OUT_DIR/avaso_gateway_dump_latest.sql"
    ;;
  data)
    load_database_url
    if [[ -z "${DATABASE_URL:-}" ]]; then
      echo "FAIL: data cần DATABASE_URL (.env hoặc /etc/avaso-gateway/env)" >&2
      exit 1
    fi
    OUTFILE="$OUT_DIR/avaso_gateway_data_${TIMESTAMP}.sql"
    echo "==> Xuất dữ liệu (INSERT) → $OUTFILE"
    run_pg_dump "$OUTFILE" \
      --data-only --no-owner --no-privileges --inserts
    LATEST="$OUT_DIR/avaso_gateway_data_latest.sql"
    ;;
  *)
    echo "Usage: $0 [schema|dump|data]" >&2
    echo "  schema — DDL 18 bảng khớp Excel dictionary (mặc định, nộp giảng viên)" >&2
    echo "  dump   — pg_dump schema + data từ DB đang chạy" >&2
    echo "  data   — pg_dump chỉ INSERT" >&2
    exit 1
    ;;
esac

cp "$OUTFILE" "$LATEST"
echo "==> OK: $(wc -l < "$OUTFILE") dòng"
echo "==> Bản mới nhất: $LATEST"
