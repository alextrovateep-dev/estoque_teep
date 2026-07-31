#!/usr/bin/env bash
# Restaura dump Postgres (e opcionalmente uploads) gerado por backup-prod.sh.
# Uso:
#   ./scripts/restore-prod.sh backups/20260101T120000Z
# Variáveis: COMPOSE_FILE, ENV_FILE, RESTORE_UPLOADS=1

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:?informe o diretório do backup}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT/.env.production}"
RESTORE_UPLOADS="${RESTORE_UPLOADS:-0}"

if [[ ! -f "$SRC/postgres.dump" ]]; then
  echo "postgres.dump não encontrado em $SRC" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

POSTGRES_USER="${POSTGRES_USER:-teep}"
POSTGRES_DB="${POSTGRES_DB:-estoque_teep}"

echo "==> Restaurando Postgres a partir de $SRC/postgres.dump"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < "$SRC/postgres.dump" \
  || true

if [[ "$RESTORE_UPLOADS" == "1" && -f "$SRC/uploads.tar.gz" ]]; then
  VOLUME="$(docker volume ls -q | grep -E 'api_uploads$' | head -n1 || true)"
  if [[ -z "$VOLUME" ]]; then
    echo "Volume api_uploads não encontrado." >&2
    exit 1
  fi
  echo "==> Restaurando uploads"
  docker run --rm \
    -v "$VOLUME":/data \
    -v "$(cd "$SRC" && pwd)":/backup:ro \
    alpine:3.20 \
    sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /backup/uploads.tar.gz -C /data"
fi

echo "OK: restore concluído. Reinicie a API se necessário."
