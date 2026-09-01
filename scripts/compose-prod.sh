#!/usr/bin/env bash
# Wrapper: sempre usa .env.production e evita esquecer --env-file.
#
# Uso (raiz do repo):
#   ./scripts/compose-prod.sh ps
#   ./scripts/compose-prod.sh logs api --tail=100
#   ./scripts/compose-prod.sh up -d api
#
# Servidor suporte (Apache + compose.suporte):
#   export TEEP_SUORTE=1
#   ./scripts/compose-prod.sh up -d api
#
# Variáveis: ENV_FILE, TEEP_SUORTE=1

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILES=(-f "$ROOT/docker-compose.prod.yml")

if [[ "${TEEP_SUORTE:-}" == "1" ]]; then
  COMPOSE_FILES+=(-f "$ROOT/docker-compose.suporte.yml")
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo $ENV_FILE não encontrado." >&2
  echo "  cp deploy/env.production.example .env.production" >&2
  exit 1
fi

export ENV_FILE

exec docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" "$@"
