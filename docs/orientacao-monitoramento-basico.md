# Monitoramento Básico - Estoque TEEP

**Para sistemas internos com volume baixo**

---

## 1. Visão Geral

Este documento descreve o monitoramento mínimo recomendado para o sistema Estoque TEEP em ambiente interno. Foco em simplicidade e custo zero.

## 2. Endpoints de Saúde

### 2.1 Health Check (`/health`)
```
GET https://api.estoque.teep.com.br/health
```
**Resposta:**
```json
{"status":"ok","service":"teep-api"}
```
**Uso:** Verificação rápida se a API está respondendo.

### 2.2 Ready Check (`/ready`)
```
GET https://api.estoque.teep.com.br/ready
```
**Resposta:**
```json
{
  "status": "ready",
  "database": true,
  "redis": true,
  "uploads": "/app/uploads"
}
```
**Uso:** Verifica dependências (banco, Redis, filesystem).

## 3. Monitoramento Automatizado (Gratuito)

### 3.1 UptimeRobot (Recomendado)
- **Site:** https://uptimerobot.com
- **Plano:** Free (50 monitors)
- **Configuração:**
  - Monitor Type: HTTP(s)
  - URL: `https://api.estoque.teep.com.br/health`
  - Check Interval: 5 minutes
  - Alert Contacts: E-mail do administrador

### 3.2 Cron Local (Alternativa Simples)

```bash
# Adicione ao crontab do servidor (crontab -e)
*/5 * * * * curl -sS --fail https://api.estoque.teep.com.br/health > /dev/null || echo "API offline $(date)" >> /var/log/teep-health.log
0 8 * * * curl -sS --fail https://api.estoque.teep.com.br/ready > /dev/null || echo "API not ready $(date)" | mail -s "Alerta Estoque TEEP" admin@teep.com.br
```

## 4. Logs Estruturados

### 4.1 Novo Sistema de Logs
O sistema agora usa logs estruturados (ver `apps/api/src/lib/logger.ts`):

**Exemplo de log em desenvolvimento:**
```
[14:30:25] INFO: [STARTUP] API listening on :4000 (http + socket.io)
```

**Exemplo de log em produção (JSON):**
```json
{"timestamp":"2024-01-01T14:30:25.000Z","level":"info","message":"[STARTUP] API listening on :4000 (http + socket.io)","service":"teep-api"}
```

### 4.2 Visualização de Logs

```bash
# Ver logs dos containers Docker
docker compose -f docker-compose.prod.yml logs --tail=100 api

# Ver logs com filtro
docker compose -f docker-compose.prod.yml logs api | grep -i error

# Seguir logs em tempo real
docker compose -f docker-compose.prod.yml logs -f api
```

### 4.3 Retenção de Logs
Por padrão, o Docker mantém logs. Configure se necessário:

```bash
# No docker-compose.prod.yml, adicione:
services:
  api:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## 5. Métricas Básicas

### 5.1 Métricas do Sistema

```bash
# Uso de CPU/Memória dos containers
docker stats

# Espaço em disco
df -h /opt/estoque-teep/

# Tamanho dos volumes Docker
du -sh /var/lib/docker/volumes/estoque-teep_*/
```

### 5.2 Métricas da Aplicação

**Endpoints úteis (se implementados futuramente):**
- `/metrics` - Métricas Prometheus
- `/status` - Status detalhado
- `/stats` - Estatísticas de uso

## 6. Alertas Recomendados

### 6.1 Críticos (Ação Imediata)
- [ ] API não responde por > 5 minutos
- [ ] Banco de dados offline
- [ ] Espaço em disco < 10%

### 6.2 Importantes (Ação no Dia)
- [ ] Backup não gerado nas últimas 24h
- [ ] Erros consecutivos em logs
- [ ] Alta utilização de CPU/Memória (>80%)

### 6.3 Informativos (Monitorar)
- [ ] Número de usuários ativos
- [ ] Volume de movimentações
- [ ] Tamanho do banco de dados

## 7. Dashboard Simples

Crie um painel manual com:

### 7.1 Status do Sistema
```bash
#!/bin/bash
# scripts/check-status.sh
echo "=== Status Estoque TEEP ==="
echo "Data: $(date)"
echo ""
echo "1. Health Check:"
curl -sS https://api.estoque.teep.com.br/health
echo ""
echo ""
echo "2. Ready Check:"
curl -sS https://api.estoque.teep.com.br/ready
echo ""
echo ""
echo "3. Containers:"
docker compose -f docker-compose.prod.yml ps
echo ""
echo "4. Últimos Logs (erros):"
docker compose -f docker-compose.prod.yml logs api --tail=20 | grep -i error || echo "Nenhum erro recente"
```

### 7.2 Métricas Diárias
```bash
# scripts/daily-metrics.sh
echo "=== Métricas Diárias ==="
echo "Backups: $(ls -la backups/ | wc -l)"
echo "Tamanho DB: $(du -sh backups/*/database.dump 2>/dev/null | tail -1)"
echo "Logs hoje: $(docker compose -f docker-compose.prod.yml logs --since=24h api | wc -l)"
```

## 8. Checklist de Monitoramento Diário

- [ ] Health check respondendo
- [ ] Backup do dia anterior gerado
- [ ] Espaço em disco suficiente
- [ ] Sem erros críticos nos logs
- [ ] Containers rodando normalmente

## 9. Ferramentas Úteis (Gratuitas)

1. **UptimeRobot** - Monitoramento de uptime
2. **cron** - Agendamento de verificações
3. **Docker logs** - Visualização de logs
4. **curl** - Testes manuais
5. **netdata** (opcional) - Monitoramento de servidor

## 10. Escalabilidade

Se o volume aumentar, considere:

1. **Logs centralizados**: ELK Stack ou Loki
2. **Métricas**: Prometheus + Grafana
3. **APM**: New Relic ou AppDynamics (versões free)
4. **Alertas avançados**: PagerDuty ou Opsgenie

---

**Nota:** Para sistema interno com volume baixo, o monitoramento básico descrito acima é suficiente. Ajuste conforme o crescimento do sistema.