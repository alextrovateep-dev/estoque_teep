# F11 — Hardening e Go-Live

**Status:** entregáveis de infra no repo. Cutover no VPS/DNS fica a cargo da operação.  
**Plano:** D13, D46, RNF13/RNF16; fase F11.

## Objetivo

Subir staging/produção com HTTPS, secrets fortes, backup (DB + `uploads/`) e checklist de cutover Go-Live A ou B.

## Arquivos

| Item | Caminho |
|------|---------|
| Compose produção | `docker-compose.prod.yml` |
| Caddy (HTTPS) | `deploy/Caddyfile` |
| Env de exemplo (prod) | `deploy/env.production.example` → `.env.production` |
| Env de exemplo (dev API) | `apps/api/.env.example` → `apps/api/.env` |
| Env de exemplo (dev Web) | `apps/web/.env.local.example` → `apps/web/.env.local` |
| Backup | `scripts/backup-prod.sh` |
| Restore | `scripts/restore-prod.sh` |

## Domínios (D13)

| Host | Serviço |
|------|---------|
| `estoque.teep.com.br` | Web (Next.js) |
| `api.estoque.teep.com.br` | API + Socket.io |

DNS: registros **A** (e **AAAA** se IPv6) do VPS para os dois hosts. Caddy emite certificado Let's Encrypt automaticamente (portas 80/443 abertas).

## Subir produção

1. No VPS: clone do repo + Docker instalado.
2. `cp deploy/env.production.example .env.production` e preencha JWT (≥32 chars), `POSTGRES_PASSWORD`, `SEED_ADMIN_PASSWORD`.
3. Primeiro boot: `SEED_ON_START=1` no `.env.production`.
4. Subir:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

5. Após admin criado e senhas trocadas: `SEED_ON_START=0` e `docker compose ... up -d` (recria só a API se necessário).
6. Smoke: `curl -sS https://api.estoque.teep.com.br/health` e login em `https://estoque.teep.com.br`.

## Backup (D46)

Cron diário no host (exemplo 02:30 UTC):

```bash
0 2 * * * cd /opt/estoque-teep && ./scripts/backup-prod.sh >> /var/log/teep-backup.log 2>&1
```

Inclui `pg_dump` (`-Fc`) + tarball do volume `api_uploads`. Retenção padrão: 14 dias (`RETAIN_DAYS`).

Restore:

```bash
./scripts/restore-prod.sh backups/20260101T120000Z
RESTORE_UPLOADS=1 ./scripts/restore-prod.sh backups/20260101T120000Z
```

## Hardening na API

- `helmet` + `trust proxy` em produção
- `assertProductionEnv`: rejeita JWT fraco/`change-me` e `CORS_ORIGIN` com localhost
- Seed **não** roda em todo start (`SEED_ON_START`)
- Postgres/Redis sem portas públicas no compose de prod

## Checklist de cutover

### Pré
- [ ] Go-Live **A** (1 filial) ou **B** (≥2 filiais + F8/F15)
- [ ] DNS propagado; HTTPS verde nos dois hosts
- [ ] Secrets fortes; senha admin seed trocada
- [ ] Backup dry-run OK
- [ ] `pnpm smoke:f10` apontando para a API de staging (`API_URL=...`)

### Go-Live A
- [ ] Cadastros + init da filial
- [ ] Compra/venda + saldo
- [ ] Smoke PC + mobile no navegador

### Go-Live B (além de A)
- [ ] 2ª filial ativa
- [ ] Transferência via Novo Lançamento (imediato + aguardar) + conferência
- [ ] Alertas F9 recomendados

### Pós
- [ ] Cron de backup ativo
- [ ] SMTP real (opcional) + preview admin F9.1
- [ ] Monitorar `/ready` e logs da API
