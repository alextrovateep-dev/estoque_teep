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

Login seed: `admin@teep.com.br` / `Admin@123`

Usuários de homologação (após `db:seed`):

| E-mail | Senha | Perfil |
|--------|-------|--------|
| `gerente@teep.com.br` | `Oper@123` | GERENTE |
| `operador@teep.com.br` | `Oper@123` | OPERADOR (PLN) |
| `operador.tbo@teep.com.br` | `Oper@123` | OPERADOR (TBO) |

Demo de produtos/fornecedor (opcional): `SEED_DEMO=1 pnpm db:seed`

## Homologação (F10)

Checklist: [`docs/F10-homologacao-checklist.md`](docs/F10-homologacao-checklist.md)

Com a API no ar:

```bash
pnpm smoke:f10
```

Valida health → login → produto → init → compra/venda → saldo → transferência PLN→TBO.

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

| Doc | Conteúdo |
|-----|----------|
| [docs/INSTALACAO.md](docs/INSTALACAO.md) | **Instalação oficial** — Debian, Docker Compose prod, VM lab, `.env.production` |
| [docs/F10-homologacao-checklist.md](docs/F10-homologacao-checklist.md) | Checklist de homologação / carga inicial |
| [docs/F11-hardening-golive.md](docs/F11-hardening-golive.md) | F11 — staging, HTTPS, backup, cutover |
| [docs/orientacao-senha-provisoria.md](docs/orientacao-senha-provisoria.md) | Senha provisória + troca no 1º acesso |
| [docs/orientacao-email-notificacoes.md](docs/orientacao-email-notificacoes.md) | F9 + F9.1 (inbox, e-mail tipado, preview admin) — orientação Alex Trova |
| [docs/orientacao-upload-midia.md](docs/orientacao-upload-midia.md) | F13 — avatar + fotos de produto |
| [docs/orientacao-assistente-estoque-llm.md](docs/orientacao-assistente-estoque-llm.md) | F14 — assistente LLM no Dashboard |
| [docs/orientacao-lancamento-unificado-f15.md](docs/orientacao-lancamento-unificado-f15.md) | F15 — lançamento unificado + transferência só conferência |
| [docs/orientacao-recuperacao-backup.md](docs/orientacao-recuperacao-backup.md) | Procedimentos de recuperação de backup e emergência |
| [docs/orientacao-monitoramento-basico.md](docs/orientacao-monitoramento-basico.md) | Monitoramento básico para sistemas internos |
| [docs/orientacao-geracao-numero-serie.md](docs/orientacao-geracao-numero-serie.md) | Orientação — geração de séries no Novo Lançamento (**implementado**; impressão Zebra em standby) |
| [docs/orientacao-impressao-zebra.md](docs/orientacao-impressao-zebra.md) | Orientação — impressão Zebra (**standby** — etiquetas no software da impressora) |
| [docs/orientacao-rma-fase2.md](docs/orientacao-rma-fase2.md) | RMA — MVP + backlog |

Após F9.1: sino no header · Admin → **E-mail**. F13: foto no cadastro. F14: assistente no Dashboard (flag `ASSISTENTE_LLM_ENABLED`). F15: transferências criadas no Novo Lançamento. RMA: menu **RMA**.

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
