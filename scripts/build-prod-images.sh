#!/usr/bin/env bash
# Build das imagens api + web para produção (rodar em máquina com Docker funcional).
# Saída: teep-prod-images.tar.gz na raiz do repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${1:-.env.production}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo não encontrado: $ENV_FILE" >&2
  echo "Uso: $0 [.env.production]" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${NEXT_PUBLIC_API_URL:?defina NEXT_PUBLIC_API_URL em $ENV_FILE}"
: "${NEXT_PUBLIC_APP_URL:?defina NEXT_PUBLIC_APP_URL em $ENV_FILE}"

echo "==> Build api (estoque-teep-api:latest)"
docker build -f apps/api/Dockerfile -t estoque-teep-api:latest .

echo "==> Build web (estoque-teep-web:latest)"
docker build -f apps/web/Dockerfile \
  --build-arg "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}" \
  --build-arg "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}" \
  -t estoque-teep-web:latest .

OUT="${ROOT}/teep-prod-images.tar.gz"
echo "==> Export ${OUT}"
docker save estoque-teep-api:latest estoque-teep-web:latest | gzip > "$OUT"
ls -lh "$OUT"
echo "Pronto. Envie ao servidor: scp -P 2222 teep-prod-images.tar.gz user@host:/tmp/"
