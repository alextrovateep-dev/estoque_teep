#!/bin/bash
# Script de verificação de status do Estoque TEEP
# Uso: ./scripts/check-status.sh

set -e

echo "=== Status Estoque TEEP ==="
echo "Data: $(date)"
echo ""

# 1. Verificar se Docker Compose está disponível
if ! command -v docker-compose &> /dev/null && ! command -v docker compose &> /dev/null; then
    echo "❌ Docker Compose não encontrado"
    exit 1
fi

DOCKER_COMPOSE_CMD="docker-compose"
if command -v docker &> /dev/null && docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
fi

# 2. Verificar containers
echo "1. Containers:"
COMPOSE_ARGS=()
if [ -f "docker-compose.prod.yml" ]; then
    COMPOSE_ARGS=(-f docker-compose.prod.yml)
    if [ -f ".env.production" ]; then
        COMPOSE_ARGS+=(--env-file .env.production)
    fi
    $DOCKER_COMPOSE_CMD "${COMPOSE_ARGS[@]}" ps 2>/dev/null || echo "  (erro ao listar containers prod)"
elif [ -f "docker-compose.yml" ]; then
    $DOCKER_COMPOSE_CMD -f docker-compose.yml ps 2>/dev/null || echo "  (erro ao listar containers)"
else
    echo "  Nenhum docker-compose encontrado"
fi

echo ""

# 3. Verificar backups
echo "2. Backups:"
if [ -d "backups" ]; then
    BACKUP_COUNT=$(find backups -maxdepth 1 -type d | wc -l)
    echo "  Total de backups: $((BACKUP_COUNT - 1))"
    
    if [ "$BACKUP_COUNT" -gt 1 ]; then
        LATEST_BACKUP=$(ls -td backups/*/ | head -1)
        LATEST_DATE=$(basename "$LATEST_BACKUP")
        echo "  Último backup: $LATEST_DATE"
        
        if [ -f "$LATEST_BACKUP/postgres.dump" ]; then
            DB_SIZE=$(du -h "$LATEST_BACKUP/postgres.dump" | cut -f1)
            echo "  Tamanho DB: $DB_SIZE"
        elif [ -f "$LATEST_BACKUP/database.dump" ]; then
            echo "  ⚠️  Encontrado database.dump (nome antigo); script atual usa postgres.dump"
        fi
        
        if [ -f "$LATEST_BACKUP/uploads.tar.gz" ]; then
            UPLOADS_SIZE=$(du -h "$LATEST_BACKUP/uploads.tar.gz" | cut -f1)
            echo "  Tamanho uploads: $UPLOADS_SIZE"
        fi
    else
        echo "  ⚠️  Nenhum backup encontrado"
    fi
else
    echo "  ⚠️  Diretório backups não encontrado"
fi

echo ""

# 4. Verificar logs recentes (apenas erros)
echo "3. Logs recentes (últimas 24h, apenas erros):"
if [ -f "docker-compose.prod.yml" ]; then
    LOG_ARGS=(-f docker-compose.prod.yml)
    [ -f ".env.production" ] && LOG_ARGS+=(--env-file .env.production)
    echo "  Usando docker-compose.prod.yml:"
    $DOCKER_COMPOSE_CMD "${LOG_ARGS[@]}" logs --since=24h api 2>/dev/null | \
        grep -i -E "(error|fail|exception|warn)" | \
        tail -5 | \
        while read -r line; do echo "    $line"; done || \
        echo "    ✅ Nenhum erro encontrado"
elif [ -f "docker-compose.yml" ]; then
    echo "  Usando docker-compose.yml:"
    $DOCKER_COMPOSE_CMD -f docker-compose.yml logs --since=24h api 2>/dev/null | \
        grep -i -E "(error|fail|exception|warn)" | \
        tail -5 | \
        while read -r line; do echo "    $line"; done || \
        echo "    ✅ Nenhum erro encontrado"
else
    echo "  Nenhum arquivo docker-compose encontrado"
fi

echo ""

# 5. Verificar espaço em disco
echo "4. Espaço em disco:"
df -h . | tail -1 | awk '{print "  Disponível: " $4 " de " $2 " (" $5 " usado)"}'

echo ""

# 6. Verificar saúde da API (se estiver rodando)
echo "5. Health Check da API:"
API_URL="http://localhost:4000"
if [ -f ".env.production" ] && grep -q "NEXT_PUBLIC_API_URL" .env.production; then
    API_URL=$(grep "NEXT_PUBLIC_API_URL" .env.production | cut -d'=' -f2-)
elif [ -f "apps/web/.env.local" ] && grep -q "NEXT_PUBLIC_API_URL" apps/web/.env.local; then
    API_URL=$(grep "NEXT_PUBLIC_API_URL" apps/web/.env.local | cut -d'=' -f2-)
fi

# Remover possíveis aspas
API_URL=$(echo "$API_URL" | tr -d '\"' | tr -d "'")

if curl -s --max-time 5 "$API_URL/health" > /dev/null 2>&1; then
    echo "  ✅ API respondendo em $API_URL"
    
    # Tentar pegar resposta detalhada
    HEALTH_RESPONSE=$(curl -s --max-time 3 "$API_URL/health" 2>/dev/null || echo "{}")
    READY_RESPONSE=$(curl -s --max-time 3 "$API_URL/ready" 2>/dev/null || echo "{}")
    
    echo "  Health: $HEALTH_RESPONSE"
    if echo "$READY_RESPONSE" | grep -q "status"; then
        echo "  Ready: $(echo "$READY_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"
    fi
else
    echo "  ⚠️  API não respondendo em $API_URL"
fi

echo ""
echo "=== Verificação concluída ==="