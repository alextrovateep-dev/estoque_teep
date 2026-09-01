#!/usr/bin/env bash
# ./scripts/compose-prod.sh — usa .env.production; TEEP_SUORTE=1 inclui docker-compose.suporte.yml
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
  exit 1
fi

export ENV_FILE
exec docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" "$@"
