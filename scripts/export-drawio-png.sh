#!/usr/bin/env bash
# Export .drawio → PNG (headless). Thử Docker → draw.io deb + xvfb → npx draw.io-export.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIAG="$ROOT/docs/diagrams"
SCALE="${DRAWIO_SCALE:-2}"
QUALITY="${DRAWIO_QUALITY:-90}"

export_one() {
  local src="$1"
  local base="${src%.drawio}"
  local out="${base}.png"
  echo "==> Export $src → $out"

  if command -v docker >/dev/null 2>&1; then
    if docker run --rm \
      -v "$DIAG:/data" -w /data \
      rlespinasse/drawio-desktop-headless:minimal \
      -x -f png -s "$SCALE" -q "$QUALITY" -o "$(basename "$out")" "$(basename "$src")" 2>/dev/null; then
      [[ -f "$out" ]] && return 0
    fi
  fi

  if command -v drawio >/dev/null 2>&1 && command -v xvfb-run >/dev/null 2>&1; then
    xvfb-run -a drawio -x -f png -s "$SCALE" -q "$QUALITY" -o "$out" "$src"
    [[ -f "$out" ]] && return 0
  fi

  if command -v npx >/dev/null 2>&1; then
    (cd "$DIAG" && npx --yes draw.io-export@0.3.0 "$(basename "$src")" -o "$(basename "$out")" -F png) && [[ -f "$out" ]] && return 0
  fi

  echo "FAIL: không export được $src (cần docker, draw.io+xvfb, hoặc npx)" >&2
  return 1
}

main() {
  mkdir -p "$DIAG"
  local ok=0 fail=0
  for f in "$DIAG"/*.drawio; do
    [[ -f "$f" ]] || continue
    if export_one "$f"; then ok=$((ok + 1)); else fail=$((fail + 1)); fi
  done
  echo ""
  echo "Draw.io export: ok=$ok fail=$fail → $DIAG/*.png"
  [[ "$fail" -eq 0 ]]
}

main "$@"
