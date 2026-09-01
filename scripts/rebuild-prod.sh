#!/usr/bin/env bash
# Rebuild sem cache no host de produção (Compose).
#
# Uso (servidor suporte):
#   cd /opt/estoque-teep
#   git pull
#   export TEEP_SUORTE=1
#   ./scripts/rebuild-prod.sh          # api + web
#   ./scripts/rebuild-prod.sh api      # só api
#
# Variáveis: TEEP_SUORTE=1, ENV_FILE

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SERVICES=("$@")
if [[ ${#SERVICES[@]} -eq 0 ]]; then
  SERVICES=(api web)
fi

echo "==> Build --no-cache: ${SERVICES[*]}"
"$ROOT/scripts/compose-prod.sh" build --no-cache "${SERVICES[@]}"

echo "==> Up -d: ${SERVICES[*]}"
"$ROOT/scripts/compose-prod.sh" up -d "${SERVICES[@]}"

"$ROOT/scripts/compose-prod.sh" ps
