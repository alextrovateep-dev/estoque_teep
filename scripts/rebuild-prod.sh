#!/usr/bin/env bash
# ./scripts/rebuild-prod.sh [api] [web] — build --no-cache + up -d
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SERVICES=("$@")
if [[ ${#SERVICES[@]} -eq 0 ]]; then
  SERVICES=(api web)
fi

"$ROOT/scripts/compose-prod.sh" build --no-cache "${SERVICES[@]}"
"$ROOT/scripts/compose-prod.sh" up -d "${SERVICES[@]}"
"$ROOT/scripts/compose-prod.sh" ps
