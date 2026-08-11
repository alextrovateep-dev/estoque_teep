# F11 — Hardening e Go-Live

**Status:** entregáveis de infra no repo. Cutover no VPS/DNS fica a cargo da operação.

**Instalação passo a passo (Debian / Docker / VM):** [INSTALACAO.md](./INSTALACAO.md) — **não** repetir o `up` aqui; este arquivo é só hardening + checklist de cutover.

## Objetivo

Confirmar HTTPS, secrets fortes, backup (DB + uploads) e cutover Go-Live A ou B **depois** que o stack já sobe conforme o INSTALACAO.

## Arquivos (referência)

| Item | Caminho |
|------|---------|
| Compose produção | `docker-compose.prod.yml` |
| Caddy (HTTPS) | `deploy/Caddyfile` (lab: `deploy/Caddyfile.lab`) |
| Env | `deploy/env.production.example` → `.env.production` |
| Backup / restore | `scripts/backup-prod.sh`, `scripts/restore-prod.sh` |
| Status rápido | `scripts/check-status.sh` / `scripts/check-status.ps1` |

Detalhe operacional: [recuperacao-backup.md](./recuperacao-backup.md) · [monitoramento-basico.md](./monitoramento-basico.md).

## Domínios

| Host | Serviço |
|------|---------|
| `estoque.teep.com.br` | Web (Next.js) |
| `api.estoque.teep.com.br` | API + Socket.io + `/uploads` |

DNS **A** (e **AAAA** se IPv6) → IP do VPS. Caddy emite Let's Encrypt com portas 80/443 abertas.

## Hardening na API (já no código / compose)

- `helmet` + `trust proxy` em produção
- `assertProductionEnv`: rejeita JWT fraco/`change-me` e `CORS_ORIGIN` com localhost
- Seed só com `SEED_ON_START=1` (depois `0`)
- Postgres/Redis **sem** portas públicas no compose de prod

## Backup

Cron diário no host (exemplo 02:30 UTC):

```bash
0 2 * * * cd /opt/estoque-teep && ./scripts/backup-prod.sh >> /var/log/teep-backup.log 2>&1
```

Gera `backups/<stamp>/` com `postgres.dump`, `uploads.tar.gz` (se houver volume) e `MANIFEST.txt`. Retenção padrão: 14 dias (`RETAIN_DAYS`).

Restore e emergência: [recuperacao-backup.md](./recuperacao-backup.md).

## Checklist de cutover

### Pré

- [ ] Stack no ar via [INSTALACAO.md](./INSTALACAO.md)
- [ ] Go-Live **A** (1 estoque/filial) ou **B** (≥2 + transferência)
- [ ] DNS propagado; HTTPS verde nos dois hosts
- [ ] Secrets fortes; senha admin seed trocada; `SEED_ON_START=0`
- [ ] Backup dry-run OK (`./scripts/backup-prod.sh`)
- [ ] Smoke: `API_URL=https://api.… pnpm smoke:f10` (máquina com pnpm)

### Go-Live A

- [ ] Cadastros + init da filial
- [ ] Compra/venda + saldo
- [ ] Smoke PC + mobile no navegador

### Go-Live B (além de A)

- [ ] 2ª filial ativa
- [ ] Transferência via Novo Lançamento (imediato + aguardar) + conferência
- [ ] Alertas / e-mail conforme operação

### Pós

- [ ] Cron de backup ativo
- [ ] SMTP real (opcional) + Admin → E-mail
- [ ] Monitorar `/health`, `/ready` e logs da API ([monitoramento](./monitoramento-basico.md))
