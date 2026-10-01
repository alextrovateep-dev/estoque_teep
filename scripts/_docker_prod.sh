# shellcheck shell=bash
# Helpers compartilhados por backup-prod.sh / restore-prod.sh.
# Não execute direto.

docker_bin() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    echo "Docker Compose não encontrado (plugin v2 ou docker-compose)." >&2
    return 1
  fi
}

compose_files() {
  local files=(-f "$COMPOSE_FILE")
  if [[ -n "${COMPOSE_OVERLAY:-}" && -f "$COMPOSE_OVERLAY" ]]; then
    files+=(-f "$COMPOSE_OVERLAY")
  elif docker ps --format '{{.Ports}}' 2>/dev/null | grep -q '127.0.0.1:4000'; then
    if [[ -f "$ROOT/docker-compose.suporte.yml" ]]; then
      files+=(-f "$ROOT/docker-compose.suporte.yml")
    fi
  fi
  files+=(--env-file "$ENV_FILE")
  printf '%s\n' "${files[@]}"
}

dc() {
  # shellcheck disable=SC2046,SC2086
  $(docker_bin) $(compose_files | tr '\n' ' ') "$@"
}

postgres_container() {
  local n
  n="$(docker ps --format '{{.Names}}' | grep -E 'postgres' | head -n1 || true)"
  if [[ -z "$n" ]]; then
    echo "Nenhum container Postgres em execução." >&2
    return 1
  fi
  echo "$n"
}

uploads_volume() {
  docker volume ls -q | grep -E 'api_uploads$' | head -n1 || true
}

# Imagem já presente no host (suporte não resolve DNS na bridge — não puxar alpine).
volume_helper_image() {
  echo "postgres:16-alpine"
}
