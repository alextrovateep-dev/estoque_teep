# Estoque TEEP

Sistema de Controle de Estoque TEEP (greenfield).

## Stack

- `apps/web` — Next.js 15 + Tailwind
- `apps/api` — Express + Prisma + PostgreSQL + Redis
- `packages/shared` — enums e schemas Zod

## Desenvolvimento local

1. Instale dependências: `pnpm install`
2. Env (só o que o sistema lê):
   - `cp apps/api/.env.example apps/api/.env`
   - `cp apps/web/.env.local.example apps/web/.env.local`
3. Suba o Postgres embutido (porta 5433): `pnpm --filter @teep/api db:pg` (deixe rodando)
4. Em outro terminal:

```bash
pnpm --filter @teep/shared build
pnpm --filter @teep/api db:generate
pnpm --filter @teep/api db:migrate
pnpm --filter @teep/api db:seed
pnpm dev
```

O `.env.example` da API já traz `REDIS_DISABLED=1` (Redis opcional em dev). Para fila de e-mail real local, suba Redis e remova/desative essa flag.

Ou use Docker Compose com Postgres/Redis/API/Web (`docker compose up --build`).

- Web: http://localhost:3000 (abre em login)
- API: http://localhost:4000/health

Login seed: `admin@teep.com.br` / `Admin@123` (ou `SEED_ADMIN_*`).

**Homologação / smoke** — estoques PLN/TBO, usuários gerente/operador e produtos demo **só** com:

```bash
SEED_DEMO=1 pnpm --filter @teep/api db:seed
```

| E-mail | Senha | Perfil |
|--------|-------|--------|
| `gerente@teep.com.br` | `Oper@123` | GERENTE |
| `operador@teep.com.br` | `Oper@123` | OPERADOR (PLN) |
| `operador.tbo@teep.com.br` | `Oper@123` | OPERADOR (TBO) |

Sem `SEED_DEMO`, o seed cria admin + tipos/categorias; estoques nascem no cadastro (Admin → Estoques).

## Homologação / smoke

Checklist completo (cadastros, inventário, cutover A/B): [`docs/INSTALACAO.md`](docs/INSTALACAO.md) §9.

```bash
# API no ar; seed com SEED_DEMO=1 (ou PLN/TBO equivalentes)
pnpm smoke:f10
```

Valida health → login → produto → init → compra/venda → saldo → (se TBO) transferência PLN→TBO.

## Hardening / Go-Live

**Instalação oficial (Debian / Docker / VM), hardening, backup e cutover:** [`docs/INSTALACAO.md`](docs/INSTALACAO.md)

```bash
cp deploy/env.production.example .env.production
# edite secrets, DNS e SEED_ON_START=1 no primeiro boot
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
./scripts/backup-prod.sh
```

Produção: `https://estoque.teep.com.br` (web) · `https://api.estoque.teep.com.br` (API).

## Documentação

A documentação é a referência operacional do sistema (código = verdade).  
Índice: [`docs/README.md`](docs/README.md) · telas: [`docs/mapa-telas.md`](docs/mapa-telas.md)

| Doc | Conteúdo |
|-----|----------|
| [docs/mapa-telas.md](docs/mapa-telas.md) | Índice de telas → docs / permissões |
| [docs/INSTALACAO.md](docs/INSTALACAO.md) | Instalação, homologação, hardening, backup e cutover |
| [docs/recuperacao-backup.md](docs/recuperacao-backup.md) | Restore e emergência |
| [docs/monitoramento-basico.md](docs/monitoramento-basico.md) | `/health`, `/ready`, `check-status` |
| [docs/senha-provisoria.md](docs/senha-provisoria.md) | Senha provisória, 1º acesso e perfil |
| [docs/alertas-email.md](docs/alertas-email.md) | Sino, fanout, e-mail, Admin E-mail |
| [docs/upload-midia.md](docs/upload-midia.md) | Avatar, fotos, NF/docs/RMA |
| [docs/assistente-llm.md](docs/assistente-llm.md) | Assistente LLM |
| [docs/lancamento.md](docs/lancamento.md) | Novo Lançamento, transferências, aprovações |
| [docs/geracao-numero-serie.md](docs/geracao-numero-serie.md) | Séries (alocar / desfazer) |
| [docs/arvore-produto.md](docs/arvore-produto.md) | Árvore / BOM |
| [docs/rma.md](docs/rma.md) | RMA + backlog curto |
| [docs/backlog-impressao-zebra.md](docs/backlog-impressao-zebra.md) | Zebra ZD220 — backlog (a retomar) |

Sino no header · Admin → E-mail · fotos no cadastro · assistente no Dashboard (`ASSISTENTE_LLM_ENABLED`) · transferências pelo Novo Lançamento · menu RMA.

## Segurança Importante

⚠️ **ATENÇÃO:** Após copiar os arquivos `.env.example`, **EDITE OS SEGREDOS** antes de rodar em produção/staging:

1. Em `apps/api/.env` (dev):
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`: use valores próprios (≥ 32 chars)
   - **NUNCA** leve `change-me-...` para staging/produção

2. Em `.env.production` (`NODE_ENV=production`):
   - Secrets fortes e únicos; `POSTGRES_PASSWORD` forte
   - Configure `SMTP_*` para e-mails reais
   - A API **recusa subir** se JWT for fraco/`change-me` ou `CORS_ORIGIN` apontar para localhost

## Docker (dev)

```bash
docker compose up --build
```

Compose local usa `SEED_ON_START=1` e `NODE_ENV=development`. Produção: `docker-compose.prod.yml` (acima).
