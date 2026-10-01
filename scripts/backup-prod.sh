#!/usr/bin/env bash
# Backup Postgres + volume de uploads (F11 / D46).
# Uso no host com o stack no ar:
#   ./scripts/backup-prod.sh
# Variáveis: COMPOSE_FILE, COMPOSE_OVERLAY, ENV_FILE, BACKUP_DIR, RETAIN_DAYS

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/_docker_prod.sh
source "$ROOT/scripts/_docker_prod.sh"

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
PG="$(postgres_container)"

echo "==> Dump Postgres ($PG) → $OUT/postgres.dump"
docker exec -i "$PG" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$OUT/postgres.dump"
if [[ ! -s "$OUT/postgres.dump" ]]; then
  echo "Dump vazio — abortando." >&2
  exit 1
fi

VOLUME="$(uploads_volume)"
if [[ -z "$VOLUME" ]]; then
  echo "Aviso: volume api_uploads não encontrado; pulando uploads." >&2
else
  echo "==> Arquivando uploads ($VOLUME) → $OUT/uploads.tar.gz"
  docker run --rm \
    -v "$VOLUME":/data:ro \
    -v "$OUT":/backup \
    "$(volume_helper_image)" \
    tar czf /backup/uploads.tar.gz -C /data .
fi

if [[ -f "$ENV_FILE" ]]; then
  umask 077
  cp "$ENV_FILE" "$OUT/env.production"
  chmod 600 "$OUT/env.production"
fi

echo "==> Manifesto"
{
  echo "stamp=$STAMP"
  echo "postgres=postgres.dump"
  echo "uploads=uploads.tar.gz"
  echo "env=env.production"
  echo "host=$(hostname 2>/dev/null || echo unknown)"
  echo "bytes=$(wc -c < "$OUT/postgres.dump" | tr -d ' ')"
} > "$OUT/MANIFEST.txt"

echo "==> Retenção: removendo backups com mais de ${RETAIN_DAYS} dias"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETAIN_DAYS" -exec rm -rf {} +

echo "OK: $OUT"
ls -lh "$OUT"
