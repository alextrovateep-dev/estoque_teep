#!/usr/bin/env bash
# Carrega imagens exportadas e sobe o stack suporte (sem rebuild).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARCHIVE="${1:-teep-prod-images.tar.gz}"
ENV_FILE="${2:-.env.production}"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Arquivo não encontrado: $ARCHIVE" >&2
  echo "Uso: $0 [teep-prod-images.tar.gz] [.env.production]" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo não encontrado: $ENV_FILE" >&2
  exit 1
fi

echo "==> docker load < ${ARCHIVE}"
gunzip -c "$ARCHIVE" | docker load

echo "==> Imagens"
docker images | grep -E 'estoque-teep-(api|web)' || true

echo "==> docker-compose up (sem build)"
docker-compose -f docker-compose.prod.yml -f docker-compose.suporte.yml \
  --env-file "$ENV_FILE" up -d --no-build

echo "==> Status"
docker-compose -f docker-compose.prod.yml -f docker-compose.suporte.yml ps

echo "Teste local:"
echo "  curl -s http://127.0.0.1:4000/health"
echo "  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000"
