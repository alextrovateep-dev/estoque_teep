# Recuperação de backup e emergência

**Regra:** scripts reais em `scripts/backup-prod.sh` e `scripts/restore-prod.sh`.  
Instalação do stack: [INSTALACAO.md](./INSTALACAO.md).

Todos os comandos abaixo assumem a raiz do repo com `.env.production` (ex.: `/opt/estoque-teep`).

---

## 1. O que o backup gera

```text
backups/YYYYMMDDTHHMMSSZ/
├── postgres.dump     # pg_dump -Fc
├── uploads.tar.gz    # volume api_uploads (se existir)
└── MANIFEST.txt
```

Variáveis úteis do script: `COMPOSE_FILE`, `ENV_FILE`, `BACKUP_DIR`, `RETAIN_DAYS` (padrão 14).

```bash
./scripts/backup-prod.sh
```

---

## 2. Restore completo (banco + uploads)

```bash
cd /opt/estoque-teep

# Opcional: parar app antes (postgres precisa estar up para o pg_restore via compose)
docker compose -f docker-compose.prod.yml --env-file .env.production stop api web caddy

RESTORE_UPLOADS=1 ./scripts/restore-prod.sh backups/20260101T120000Z

docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

O script exige `postgres.dump` no diretório informado. `pg_restore` pode emitir avisos (`|| true` no script); valide com `/ready` e login.

### Só banco

```bash
./scripts/restore-prod.sh backups/20260101T120000Z
```

### Só uploads

```bash
RESTORE_UPLOADS=1 ./scripts/restore-prod.sh backups/20260101T120000Z
```

(O dump também será aplicado; se precisar **apenas** extrair o tar, use o volume `*_api_uploads` via `docker run` + `tar`, como no próprio `restore-prod.sh`.)

Não existe flag `--verify` no restore — conferência = arquivos presentes + `/health` + `/ready` + login.

---

## 3. Verificação pós-restore

```bash
curl -sS https://api.estoque.teep.com.br/health
curl -sS https://api.estoque.teep.com.br/ready
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=50 api
```

Lab: use os hosts do `.env.production` e `curl -k` se o Caddy for `tls internal`.

---

## 4. Emergência rápida

### API não responde

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=100 api
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production restart api
```

### Banco inconsistente

1. Pare `api` (e idealmente `web`/`caddy`).
2. Restore do último backup consistente.
3. `up -d` e valide login / saldos críticos.

```bash
./scripts/restore-prod.sh "$(ls -td backups/*/ | head -1)"
```

---

## 5. Checklist de recuperação

- [ ] Causa raiz identificada (ou pelo menos contida)
- [ ] Backup escolhido (mais recente **consistente**)
- [ ] Restore executado
- [ ] `/health` + `/ready` OK
- [ ] Login e smoke mínimo (saldo / movimentação recente)
- [ ] Incidente registrado; cron de backup revisado se falhou

---

## 6. Manutenção

| Frequência | Ação |
|------------|------|
| Diário | Backup via cron ([INSTALACAO](./INSTALACAO.md) §7.2) |
| Mensal | Restore de teste em lab/staging |
| Sempre | Não apagar volumes Docker sem backup |
