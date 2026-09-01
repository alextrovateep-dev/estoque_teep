#!/usr/bin/env bash
# ./scripts/compose-prod.sh — .env.production; TEEP_SUORTE=1 → docker-compose.suporte.yml
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILES=(-f "$ROOT/docker-compose.prod.yml")

if [[ "${TEEP_SUORTE:-}" == "1" ]]; then
  COMPOSE_FILES+=(-f "$ROOT/docker-compose.suporte.yml")
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERRO: $ENV_FILE não encontrado." >&2
  exit 1
fi

if grep -qE '^SMTP_PASS=' "$ENV_FILE"; then
  echo "ERRO: remova SMTP_PASS= do .env.production — Compose expande \$ e estraga a senha." >&2
  echo "      Use SMTP_PASS_B64=\$(echo -n 'sua-senha' | base64 -w0)" >&2
  exit 1
fi

# Compose --env-file expande \$; arquivo temporário evita WARN se sobrar lixo comentado.
COMPOSE_ENV="$(mktemp)"
trap 'rm -f "$COMPOSE_ENV"' EXIT
grep -vE '^SMTP_PASS=' "$ENV_FILE" > "$COMPOSE_ENV"

export ENV_FILE
exec docker compose "${COMPOSE_FILES[@]}" --env-file "$COMPOSE_ENV" "$@"
