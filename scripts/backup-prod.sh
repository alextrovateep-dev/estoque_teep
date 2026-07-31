#!/usr/bin/env bash
# Backup Postgres + volume de uploads (F11 / D46).
# Uso no host com Docker Compose de produção:
#   ./scripts/backup-prod.sh
# Variáveis opcionais: COMPOSE_FILE, ENV_FILE, BACKUP_DIR, RETAIN_DAYS

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT/.env.production}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/$STAMP"

mkdir -p "$OUT"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo $ENV_FILE não encontrado." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

POSTGRES_USER="${POSTGRES_USER:-teep}"
POSTGRES_DB="${POSTGRES_DB:-estoque_teep}"

echo "==> Dump Postgres → $OUT/postgres.dump"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$OUT/postgres.dump"

VOLUME="$(docker volume ls -q | grep -E 'api_uploads$' | head -n1 || true)"
if [[ -z "$VOLUME" ]]; then
  echo "Aviso: volume api_uploads não encontrado; pulando uploads." >&2
else
  echo "==> Arquivando uploads ($VOLUME) → $OUT/uploads.tar.gz"
  docker run --rm \
    -v "$VOLUME":/data:ro \
    -v "$OUT":/backup \
    alpine:3.20 \
    tar czf /backup/uploads.tar.gz -C /data .
fi

echo "==> Manifesto"
{
  echo "stamp=$STAMP"
  echo "postgres=postgres.dump"
  echo "uploads=uploads.tar.gz"
  echo "host=$(hostname 2>/dev/null || echo unknown)"
} > "$OUT/MANIFEST.txt"

echo "==> Retenção: removendo backups com mais de ${RETAIN_DAYS} dias"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETAIN_DAYS" -exec rm -rf {} +

echo "OK: $OUT"
