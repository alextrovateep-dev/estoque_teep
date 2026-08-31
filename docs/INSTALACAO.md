# Instalação — TEEP Estoque

**Regra do projeto:** a instalação **correta e confiável** é sempre a de **produção Docker** (`docker-compose.prod.yml` + `.env.production` + Caddy).  
Não use `pnpm`/Postgres embutido nem o `docker-compose.yml` de desenvolvimento como “instalação do sistema” em servidor ou VM de validação.

| Ambiente | O que usar |
|----------|------------|
| **Oficial (VPS / go-live)** | Este guia · DNS público · HTTPS Let's Encrypt |
| **VM Debian no PC (ensaio)** | **Mesmo** compose de produção · hosts locais · `deploy/Caddyfile.lab` |
| **Dev na máquina do programador** | `README.md` (pnpm ou `docker compose` sem `.prod`) — fora do escopo deste arquivo |

Este arquivo cobre **instalar** o stack e **homologar** (cadastros, inventário, smoke) antes do go-live.

Servidor **TechCenter** (ainda não instalar): [INSTALACAO-TECHCENTER.md](./INSTALACAO-TECHCENTER.md).  
Servidor **suporte** (Apache + build off-site): [INSTALACAO-SUPORTE.md](./INSTALACAO-SUPORTE.md).

---

## 1. O que sobe

| Serviço | Função |
|---------|--------|
| `postgres` | Banco (volume `pgdata`) — **sem** porta pública |
| `redis` | Fila / cache (volume `redisdata`) — **sem** porta pública |
| `api` | Express + Prisma + uploads (volume `api_uploads`) |
| `web` | Next.js |
| `caddy` | Proxy **80/443** · HTTPS · roteia web e API |

Domínios previstos (produção):

- Web: `https://estoque.teep.com.br`
- API: `https://api.estoque.teep.com.br`

---

## 2. Requisitos do host

### 2.1 Hardware (mínimo)

| | Lab / VM | Produção |
|--|----------|----------|
| RAM | 4 GB (8 GB recomendado) | 4 GB+ |
| Disco | 40 GB | 60 GB+ (backups) |
| CPU | 2 vCPU | 2+ |

### 2.2 Sistema

- **Debian 12 (Bookworm)** ou equivalente
- Docker Engine + plugin **Compose v2**
- Git
- Portas **80** e **443** livres (e acessíveis na rede / internet no go-live)

### 2.3 Instalar Docker no Debian

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Encerre a sessão SSH/local e entre de novo. Confira:

```bash
docker --version
docker compose version
```

---

## 3. Obter o código

```bash
sudo mkdir -p /opt
sudo chown "$USER:$USER" /opt
cd /opt
git clone https://github.com/alextrovateep-dev/estoque_teep.git estoque-teep
cd estoque-teep
```

Em VM de lab, também serve copiar o projeto (pasta compartilhada / `scp`), desde que a **raiz do repo** contenha `docker-compose.prod.yml` e `deploy/`.

---

## 4. Configuração (`.env.production`)

### 4.1 Criar o arquivo

```bash
cp deploy/env.production.example .env.production
chmod 600 .env.production
```

**Nunca** commite `.env.production` preenchido.

### 4.2 Gerar secrets

```bash
# JWT (≥ 32 caracteres, aleatórios)
openssl rand -hex 32
openssl rand -hex 32

# Senha do Postgres
openssl rand -base64 24
```

Preencha no `.env.production` (obrigatório):

| Variável | Notas |
|----------|--------|
| `POSTGRES_PASSWORD` | Forte; usada só na rede Docker |
| `JWT_ACCESS_SECRET` | ≥ 32 chars; **sem** `change-me` |
| `JWT_REFRESH_SECRET` | ≥ 32 chars; diferente do access |
| `SEED_ADMIN_PASSWORD` | Senha inicial do admin (trocar no 1º login) |
| `WEB_HOST` / `API_HOST` | Hostnames do Caddy |
| `NEXT_PUBLIC_APP_URL` | URL pública do front (`https://…`) |
| `NEXT_PUBLIC_API_URL` | URL pública da API (`https://…`) |
| `CORS_ORIGIN` | Igual à origem do front (sem barra no final) |

A API **recusa subir** em `NODE_ENV=production` com JWT fraco ou `CORS_ORIGIN` apontando para localhost.

### 4.3 Seed no primeiro boot

No **primeiro** `up`:

```env
SEED_ON_START=1
SEED_ADMIN_EMAIL=admin@teep.com.br
SEED_ADMIN_PASSWORD=<senha-forte-que-voce-escolheu>
```

Depois que o admin existir e a senha for trocada no sistema:

1. Coloque `SEED_ON_START=0`
2. Recrie só a API:  
   `docker compose -f docker-compose.prod.yml --env-file .env.production up -d api`

### 4.4 Opcional

| Bloco | Quando |
|-------|--------|
| `SMTP_*` / `EMAIL_*` | E-mail real (senha provisória, alertas) |
| `ASSISTENTE_LLM_ENABLED` + chaves LLM | Assistente no Dashboard |
| `RMA_FILIAL_*` | Só se precisar fixar UUIDs de estoque RMA/DESC |

Referência completa comentada: `deploy/env.production.example`.

---

## 5. Instalação oficial (VPS + DNS público)

### 5.1 DNS

Crie registros **A** (e **AAAA** se houver IPv6) para:

- `estoque.teep.com.br` → IP do servidor  
- `api.estoque.teep.com.br` → mesmo IP  

Aguarde propagação. Portas **80** e **443** devem estar abertas no firewall/security group (Let's Encrypt).

### 5.2 Exemplo de `.env.production` (produção)

```env
WEB_HOST=estoque.teep.com.br
API_HOST=api.estoque.teep.com.br
NEXT_PUBLIC_APP_URL=https://estoque.teep.com.br
NEXT_PUBLIC_API_URL=https://api.estoque.teep.com.br
CORS_ORIGIN=https://estoque.teep.com.br

POSTGRES_USER=teep
POSTGRES_PASSWORD=<secreto>
POSTGRES_DB=estoque_teep

JWT_ACCESS_SECRET=<openssl-rand-hex-32>
JWT_REFRESH_SECRET=<outro-openssl-rand-hex-32>
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

SEED_ON_START=1
SEED_ADMIN_EMAIL=admin@teep.com.br
SEED_ADMIN_PASSWORD=<senha-inicial>
```

### 5.3 Subir

Em VM com **≤ 4 GB RAM**, construa as imagens **uma de cada vez** (api e web em paralelo costumam estourar memória no `pnpm install` — exit code 228/137):

```bash
cd /opt/estoque-teep
# opcional: swap de 2G se free -h mostrar pouca memória
# sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile

docker compose -f docker-compose.prod.yml --env-file .env.production build api
docker compose -f docker-compose.prod.yml --env-file .env.production build web
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Com **8 GB+**, pode subir tudo de uma vez:

```bash
cd /opt/estoque-teep
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Acompanhe:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
```

### 5.4 Validar

```bash
curl -sS https://api.estoque.teep.com.br/health
```

Abra `https://estoque.teep.com.br` → login com o admin do seed → **troque a senha**.

Depois: `SEED_ON_START=0` (ver §4.3).

---

## 6. Ensaio em VM Debian no PC (mesmo empacotamento)

Objetivo: validar **a mesma instalação** sem DNS público. Usa certificado **interno** do Caddy (`deploy/Caddyfile.lab`).

### 6.1 Hostnames no lab

Escolha nomes locais (exemplo):

- `estoque.lab`
- `api.estoque.lab`

**Na VM (Debian):**

```bash
echo '127.0.0.1 estoque.lab api.estoque.lab' | sudo tee -a /etc/hosts
```

**No Windows (host da VM),** se for acessar pelo browser do Windows, edite  
`C:\Windows\System32\drivers\etc\hosts` (como Administrador):

```text
<IP-DA-VM>  estoque.lab
<IP-DA-VM>  api.estoque.lab
```

Descubra o IP da VM: `ip -4 a` (Debian).

### 6.2 `.env.production` de lab

```env
WEB_HOST=estoque.lab
API_HOST=api.estoque.lab
NEXT_PUBLIC_APP_URL=https://estoque.lab
NEXT_PUBLIC_API_URL=https://api.estoque.lab
CORS_ORIGIN=https://estoque.lab

POSTGRES_USER=teep
POSTGRES_PASSWORD=<secreto-lab>
POSTGRES_DB=estoque_teep

JWT_ACCESS_SECRET=<openssl-rand-hex-32>
JWT_REFRESH_SECRET=<outro-openssl-rand-hex-32>

SEED_ON_START=1
SEED_ADMIN_EMAIL=admin@teep.com.br
SEED_ADMIN_PASSWORD=<senha-inicial>
```

Secrets **fortes** mesmo no lab (a API valida igual em `production`).

### 6.3 Usar o Caddy de lab

Monte o Caddyfile de laboratório (TLS interno):

```bash
# uma vez, ou sempre antes do up no lab
cp deploy/Caddyfile.lab deploy/Caddyfile
```

> Em go-live real, volte o Caddyfile do Git (`git checkout -- deploy/Caddyfile`) para Let's Encrypt.

Firewall na VM (lab):

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable   # se usar ufw
```

### 6.4 Subir (igual à produção)

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### 6.5 Browser e certificado

`tls internal` gera CA local do Caddy. O browser pode avisar certificado não confiável:

- Aceite a exceção **só no lab**, ou  
- Importe a CA do volume Caddy (avançado; opcional)

Abra: `https://estoque.lab`  
Health: `curl -k https://api.estoque.lab/health`

### 6.6 O que **não** fazer no lab “oficial”

- Não use `docker compose up` (arquivo **sem** `.prod`) para validar instalação de servidor.  
- Não aponte `NEXT_PUBLIC_API_URL` para `http://localhost:4000` se o browser estiver em outro SO/máquina.

---

## 7. Operação do dia a dia

### 7.1 Comandos úteis

```bash
cd /opt/estoque-teep
ENVF=( -f docker-compose.prod.yml --env-file .env.production )

docker compose "${ENVF[@]}" ps
docker compose "${ENVF[@]}" logs -f api web caddy
docker compose "${ENVF[@]}" restart api
docker compose "${ENVF[@]}" pull   # se usar imagens versionadas no futuro
docker compose "${ENVF[@]}" up -d --build
```

### 7.2 Backup

```bash
./scripts/backup-prod.sh
```

Gera `backups/<timestamp>/` com `postgres.dump`, `uploads.tar.gz` (se houver) e `MANIFEST.txt`. Retenção padrão: 14 dias (`RETAIN_DAYS`).

Cron diário no host (exemplo 02:30 UTC):

```bash
0 2 * * * cd /opt/estoque-teep && ./scripts/backup-prod.sh >> /var/log/teep-backup.log 2>&1
```

Restore / emergência: [recuperacao-backup.md](./recuperacao-backup.md).

```bash
RESTORE_UPLOADS=1 ./scripts/restore-prod.sh backups/<timestamp>
```

Status rápido: `./scripts/check-status.sh` — [monitoramento-basico.md](./monitoramento-basico.md).

### 7.3 Atualizar o sistema

```bash
cd /opt/estoque-teep
git pull
# revise .env.production se o example ganhou variáveis novas
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Mantenha `SEED_ON_START=0` em updates.

---

## 8. Hardening (já no stack de produção)

- `helmet` + `trust proxy` na API  
- `assertProductionEnv`: rejeita JWT fraco/`change-me` e `CORS_ORIGIN` com localhost  
- Postgres/Redis **sem** portas públicas no compose de prod  
- Seed só com `SEED_ON_START=1` no primeiro boot; depois `0`

## 9. Homologação e cutover

**DoD:** stack no ar · cadastros reais · init de saldos · smoke OK · transferência se ≥2 estoques (Go-Live B).

**Seed (instalação limpa):** só admin + tipos **internos** (`sistema`, ocultos no cadastro). Categorias, Compra/Venda, estoques PLN/TBO e usuários homolog **só** com `SEED_DEMO=1`. Sem demo, Admin → Tipos começa vazio — você cadastra as operações na validação. Herança antiga: `prisma migrate reset --force` (não use só `db:seed`).

### 9.1 Credenciais (SEED_DEMO=1)

| E-mail | Perfil | Senha padrão | Estoque |
|--------|--------|--------------|---------|
| `SEED_ADMIN_EMAIL` (padrão `admin@teep.com.br`) | ADMIN | `SEED_ADMIN_PASSWORD` (padrão `Admin@123`) | PLN (+ RMA) |
| `gerente@teep.com.br` | GERENTE | `SEED_OPS_PASSWORD` (padrão `Oper@123`) | PLN (+ RMA) |
| `operador@teep.com.br` | OPERADOR | idem | PLN (+ RMA) |
| `operador.tbo@teep.com.br` | OPERADOR | idem | TBO (+ RMA) |

Também com demo: estoques **RMA** / **DESC** e 3 produtos + fornecedor **sem saldos** (saldo via `/estoque/init`).

### 9.2 Stack no ar

- [ ] `docker compose … ps` — healthy / running  
- [ ] `curl` no `/health` da API (HTTPS)  
- [ ] Login admin + troca de senha  
- [ ] `SEED_ON_START=0` após o primeiro boot  
- [ ] (Prod) DNS + HTTPS válido  
- [ ] Backup dry-run + cron (§7.2)  

Em **dev** (`pnpm`), para smoke com PLN/TBO: `SEED_DEMO=1 pnpm --filter @teep/api db:seed`.

### 9.3 Cadastros reais

- [ ] Estoques ativos (Go-Live A: 1 · B: ≥2)  
- [ ] Categorias, produtos (código único; série só com inventário alinhado)  
- [ ] Clientes / fornecedores  
- [ ] Usuários reais + preferências de alerta  

### 9.4 Inventário

- [ ] `/estoque/init` — saldos conferidos; séries = 1 unidade cada  
- [ ] `confirmarReinit` só se for sobrescrever de propósito  
- [ ] Go-Live B: init na 2ª filial **ou** carga na origem + transferência  

### 9.5 Smoke

```bash
# API no ar; precisa PLN (TBO para transferência)
pnpm smoke:f10
API_URL=https://api.estoque.teep.com.br pnpm smoke:f10
```

Ordem do script: health → login → produto → init 50 → compra +10 → venda −5 → saldo 55 → (se TBO) transferência aguardar → conferir → TBO 8.

- [ ] Exit 0  
- [ ] (Opcional) `pnpm smoke:extra` — crédito IMEDIATO  
- Outros `apps/api/scripts/smoke-*.ts` sob demanda  

**Manual (UI):** Compra / Venda · Dashboard · (opc.) aprovação · (B) transferência imediata e aguardar · séries + filtro em Movimentações/Dashboard.

### 9.6 Go-Live A vs B

| Gate | Estoques | Além do stack |
|------|----------|----------------|
| **A** | 1 | Cadastros + init + compra/venda |
| **B** | ≥2 | + transferência (Novo Lançamento + conferência) + alertas |

- [ ] Gate A ou B definido pelo time  
- [ ] Smoke PC + mobile  

### 9.7 Pós go-live

- [ ] SMTP real (opcional) + Admin → E-mail  
- [ ] Monitorar `/health`, `/ready` e logs ([monitoramento-basico.md](./monitoramento-basico.md))  

### 9.8 Assinatura

| Campo | Valor |
|-------|--------|
| Ambiente | |
| Data | |
| Responsável | |
| Gate | A / B |
| Smoke `pnpm smoke:f10` | OK / NOK |
| Homologação | ☐ Aprovada ☐ Reprovada |

---

## 10. Problemas comuns

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| Build falha com **`ERR_PNPM_ENOSPC`** / exit **228** | Disco cheio (Docker layer + cache) | `df -h`; limpar: `docker system prune -af --volumes` (cuidado: remove volumes órfãos); apagar imagens intermediárias; ver §5.3 |
| Build falha em `pnpm install` (exit **228** / **137**) sem ENOSPC | RAM insuficiente (api+web em paralelo) ou lockfile ausente | `git pull`; build sequencial (`build api` depois `build web`); criar swap 2G; ver §5.3 |
| API não sobe; log fala de JWT / CORS | Secret fraco ou `CORS_ORIGIN` com localhost | Corrija `.env.production` e `up -d` de novo |
| Caddy sem certificado (prod) | DNS não aponta / 80 fechada | Ajuste DNS e firewall; `logs caddy` |
| Front chama API errada | `NEXT_PUBLIC_*` do **build** | Esses valores entram no **build** da imagem `web`; altere o env e `--build` de novo |
| Login CORS | `CORS_ORIGIN` ≠ origem do browser | Tem que ser exatamente `https://WEB_HOST` |
| Upload / fotos sumindo após recreate | Volume `api_uploads` ok? | Não apague volumes sem backup |
| Seed repetindo usuários | `SEED_ON_START=1` em todo restart | Passe para `0` |

---

## 11. Mapa rápido de arquivos

| Arquivo | Papel |
|---------|--------|
| `docker-compose.prod.yml` | **Instalação oficial** |
| `deploy/env.production.example` | Modelo → `.env.production` |
| `deploy/Caddyfile` | HTTPS Let's Encrypt (produção) |
| `deploy/Caddyfile.lab` | HTTPS interno (VM lab) |
| `scripts/backup-prod.sh` | Backup (`postgres.dump` + uploads) |
| `scripts/restore-prod.sh` | Restore |
| `scripts/check-status.sh` | Health / containers / último backup |
| `apps/api/.env.example` | Só desenvolvimento local da API |
| `docker-compose.yml` | Só desenvolvimento — **não** é instalação de servidor |

---

## 12. Resumo da regra

1. Servidor ou VM de validação → **sempre** `docker-compose.prod.yml` + `.env.production`.  
2. Produção real → DNS público + `deploy/Caddyfile` (Let's Encrypt).  
3. VM no PC → mesmos arquivos + hosts + `deploy/Caddyfile.lab`.  
4. Configuração em **um** arquivo: `.env.production`.  
5. Depois do primeiro boot: `SEED_ON_START=0`, backup agendado e homologação (§9).
