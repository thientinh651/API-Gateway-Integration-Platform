#!/usr/bin/env bash
# Apply SQL migrations in migrations/ (sorted by filename).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATABASE_URL="${DATABASE_URL:-postgres://avaso:avaso@127.0.0.1:5432/avaso_gateway}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found — set DATABASE_URL and install PostgreSQL client" >&2
  exit 1
fi

echo "==> DATABASE_URL=${DATABASE_URL}"
for f in "$ROOT"/migrations/*.sql; do
  [ -f "$f" ] || continue
  echo "==> $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
echo "==> migrations done"
