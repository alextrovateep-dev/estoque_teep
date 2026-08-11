# Monitoramento básico — Estoque TEEP

Para instalação interna / volume baixo. Stack oficial: [INSTALACAO.md](./INSTALACAO.md).

---

## 1. Endpoints (API)

### `/health`

```bash
curl -sS https://api.estoque.teep.com.br/health
# {"status":"ok","service":"teep-api"}
```

Processo vivo (não valida Postgres/Redis).

### `/ready`

```bash
curl -sS https://api.estoque.teep.com.br/ready
```

Resposta típica:

```json
{
  "status": "ready",
  "database": true,
  "redis": true,
  "uploads": "/app/uploads"
}
```

`503` se DB/Redis falharem. **Não** existem `/metrics`, `/status` ou `/stats` no código atual.

---

## 2. Script de status no repo

Na raiz do clone (com `.env.production` se for prod):

```bash
./scripts/check-status.sh
# Windows (dev/ops local):
.\scripts\check-status.ps1
```

Usa `docker compose -f docker-compose.prod.yml` (e `--env-file` quando houver `.env.production`), lista backups (`postgres.dump` / `uploads.tar.gz`) e consulta `/health` + `/ready` na URL pública do env.

---

## 3. Cron / uptime externo

```bash
*/5 * * * * curl -sS --fail https://api.estoque.teep.com.br/health > /dev/null || echo "API offline $(date)" >> /var/log/teep-health.log
0 8 * * * curl -sS --fail https://api.estoque.teep.com.br/ready > /dev/null || echo "API not ready $(date)" >> /var/log/teep-health.log
```

Opcional: UptimeRobot (ou similar) em `https://api.…/health` a cada 5 min.

Backup diário: ver [F11-hardening-golive.md](./F11-hardening-golive.md).

---

## 4. Logs

Produção: logger JSON em `apps/api/src/lib/logger.ts`.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=100 api
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
```

Retenção de log do Docker **não** está fixada no `docker-compose.prod.yml`; se precisar, configure `logging:` no serviço `api` no host (opcional).

---

## 5. Métricas de host

```bash
docker stats
df -h /opt/estoque-teep/
du -sh /var/lib/docker/volumes/*api_uploads* 2>/dev/null
```

---

## 6. Alertas mínimos

| Prioridade | Sinal |
|------------|--------|
| Crítico | `/health` falha > 5 min; disco < 10% |
| Importante | Sem pasta nova em `backups/` nas últimas 24h; `/ready` 503 |
| Ops | Erros repetidos em `logs api` |

---

## 7. Checklist diário

- [ ] Health (ou UptimeRobot) OK  
- [ ] Backup do dia anterior presente (`postgres.dump`)  
- [ ] Disco OK  
- [ ] Containers `ps` healthy/running  
