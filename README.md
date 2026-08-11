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

Ou use Docker Compose com Postgres/Redis/API/Web (`docker compose up --build`).

- Web: http://localhost:3000 (abre em login)
- API: http://localhost:4000/health

Login seed: `admin@teep.com.br` / `Admin@123` (ou `SEED_ADMIN_*`).

**Homologação / smoke F10** — estoques PLN/TBO, usuários gerente/operador e produtos demo **só** com:

```bash
SEED_DEMO=1 pnpm --filter @teep/api db:seed
```

| E-mail | Senha | Perfil |
|--------|-------|--------|
| `gerente@teep.com.br` | `Oper@123` | GERENTE |
| `operador@teep.com.br` | `Oper@123` | OPERADOR (PLN) |
| `operador.tbo@teep.com.br` | `Oper@123` | OPERADOR (TBO) |

Sem `SEED_DEMO`, o seed cria admin + tipos/categorias; estoques nascem no cadastro (Admin → Estoques).

## Homologação (F10)

Checklist: [`docs/F10-homologacao-checklist.md`](docs/F10-homologacao-checklist.md)

Com a API no ar:

```bash
pnpm smoke:f10
```

Valida health → login → produto → init → compra/venda → saldo → (se TBO) transferência PLN→TBO.  
Requer seed com `SEED_DEMO=1` (ou PLN/TBO equivalentes). Detalhe: [`docs/F10-homologacao-checklist.md`](docs/F10-homologacao-checklist.md).

## Hardening / Go-Live (F11)

Guia de cutover: [`docs/F11-hardening-golive.md`](docs/F11-hardening-golive.md)  
**Instalação oficial (Debian / Docker / VM):** [`docs/INSTALACAO.md`](docs/INSTALACAO.md)

```bash
cp deploy/env.production.example .env.production
# edite secrets, DNS e SEED_ON_START=1 no primeiro boot
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
./scripts/backup-prod.sh
```

Produção: `https://estoque.teep.com.br` (web) · `https://api.estoque.teep.com.br` (API).

## Documentação

Índice da pasta: [`docs/README.md`](docs/README.md) · telas: [`docs/mapa-telas.md`](docs/mapa-telas.md)

| Doc | Conteúdo |
|-----|----------|
| [docs/mapa-telas.md](docs/mapa-telas.md) | Índice de telas → docs / permissões |
| [docs/INSTALACAO.md](docs/INSTALACAO.md) | Instalação oficial (Docker prod / VM) |
| [docs/F10-homologacao-checklist.md](docs/F10-homologacao-checklist.md) | Homologação / carga inicial |
| [docs/F11-hardening-golive.md](docs/F11-hardening-golive.md) | Cutover / hardening |
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

1. Em `apps/api/.env`:
   - `JWT_ACCESS_SECRET`: mínimo 32 caracteres aleatórios
   - `JWT_REFRESH_SECRET`: mínimo 32 caracteres aleatórios
   - **NUNCA** use os valores de exemplo (`change-me-...`)

2. Em `.env.production` (produção):
   - Todos os secrets devem ser fortes e únicos
   - `POSTGRES_PASSWORD` deve ser forte
   - Configure `SMTP_*` para e-mails reais

O sistema **falhará ao iniciar** se detectar secrets fracos em produção.

## Docker (dev)

```bash
docker compose up --build
```

Compose local usa `SEED_ON_START=1` e `NODE_ENV=development`. Produção: `docker-compose.prod.yml` (acima).
