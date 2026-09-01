# Instalação no servidor suporte

**Host:** `suporte` · IP `174.138.62.243` · SSH porta **2222**  
**SO:** Debian 9 (stretch) · Docker CE 19.03  
**Coexistência:** Apache2 já usa **80/443** (helpdesk/wiki). MySQL/Sendmail do host **não** entram no TEEP.

**Guia genérico:** [INSTALACAO.md](./INSTALACAO.md)  
**Compose deste host:** `docker-compose.prod.yml` + `docker-compose.suporte.yml` (sem Caddy público).

---

## DNS (TEEP)

| Tipo | Nome | Valor |
|------|------|--------|
| A | `estoque.teep.com.br` | `174.138.62.243` |
| A | `api.estoque.teep.com.br` | `174.138.62.243` |

Usuário acessa só `https://estoque.teep.com.br`. O host `api.` é endpoint técnico (JSON, uploads, Socket.io).

---

## Particularidade deste servidor — build Docker

Neste Debian 9 + Docker 19.03 a **rede bridge não resolve DNS** (UDP 53). Containers alcançam IP externo, mas `apk`/`pnpm` falham no build.

**Solução adotada:** build das imagens `api` e `web` **fora do servidor** e importação com `docker load`.

Scripts:

| Onde | Comando |
|------|---------|
| PC Linux/Mac | `./scripts/build-prod-images.sh .env.production` |
| PC Windows | `.\scripts\build-prod-images.ps1` |
| Servidor | `./scripts/load-prod-images.sh /tmp/teep-prod-images.tar.gz` |

Saída do build: `teep-prod-images.tar.gz` (~1–2 GB).

---

## Checklist passo a passo

### 1. Preparar o host

```bash
# Swap 2G (se ainda 0)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker DNS (copiar deploy/docker-daemon-suporte.json)
sudo mkdir -p /etc/docker
sudo cp deploy/docker-daemon-suporte.json /etc/docker/daemon.json
sudo systemctl restart docker
sudo usermod -aG docker "$USER"
```

### 2. Clonar (SSH deploy key)

```bash
sudo mkdir -p /opt && sudo chown "$USER:$USER" /opt
cd /opt
git clone git@github.com:alextrovateep-dev/estoque_teep.git estoque-teep
cd /opt/estoque-teep
```

### 3. `.env.production`

```bash
cp deploy/env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

Mínimo:

```env
WEB_HOST=estoque.teep.com.br
API_HOST=api.estoque.teep.com.br
NEXT_PUBLIC_APP_URL=https://estoque.teep.com.br
NEXT_PUBLIC_API_URL=https://api.estoque.teep.com.br
CORS_ORIGIN=https://estoque.teep.com.br

POSTGRES_USER=teep
POSTGRES_PASSWORD=<openssl rand -base64 24>
POSTGRES_DB=estoque_teep

JWT_ACCESS_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<openssl rand -base64 48>

SEED_ON_START=1
SEED_ADMIN_EMAIL=admin@teep.com.br
SEED_ADMIN_PASSWORD=<senha forte>
```

### 4. Build fora + enviar imagens

**No PC** (com `.env.production` ou variáveis iguais às do servidor):

```powershell
cd C:\Users\trova\Documents\Projetos_Alex\Estoque_teep
.\scripts\build-prod-images.ps1
scp -P 2222 teep-prod-images.tar.gz alextrova@174.138.62.243:/tmp/
```

**No servidor:**

```bash
cd /opt/estoque-teep
git pull
chmod +x scripts/load-prod-images.sh
./scripts/load-prod-images.sh /tmp/teep-prod-images.tar.gz .env.production
```

Teste local:

```bash
curl -s http://127.0.0.1:4000/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000
```

### 5. Apache + HTTPS

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel ssl headers rewrite
sudo cp deploy/apache-suporte-vhosts.conf /etc/apache2/sites-available/teep-estoque.conf
```

**Primeira emissão de certificado:** comente os blocos `<VirtualHost *:443>` e os redirects HTTP→HTTPS nos `:80`, ou use só certbot:

```bash
sudo apt-get install -y certbot python-certbot-apache
sudo certbot --apache -d estoque.teep.com.br -d api.estoque.teep.com.br
```

Depois restaure o vhost completo (proxy para `127.0.0.1:3000` e `127.0.0.1:4000`):

```bash
sudo a2ensite teep-estoque.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

### 6. Pós-instalação

1. Login em `https://estoque.teep.com.br`
2. Trocar senha do admin
3. No `.env.production`: `SEED_ON_START=0` e reiniciar API:
   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.suporte.yml \
     --env-file .env.production up -d api
   ```

### Comandos do dia a dia (servidor suporte)

Na raiz `/opt/estoque-teep`:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.suporte.yml \
  --env-file .env.production ps

docker compose -f docker-compose.prod.yml -f docker-compose.suporte.yml \
  --env-file .env.production logs api --tail=100

docker compose -f docker-compose.prod.yml -f docker-compose.suporte.yml \
  --env-file .env.production up -d api
```

**Senha SMTP com `$`:** remova `SMTP_PASS=` do `.env.production`. Use só `SMTP_PASS_B64`:

```bash
echo -n 'SUA_SENHA_LITERAL' | base64 -w0
# SMTP_PASS_B64=... no .env.production
```

**Build sem cache (api):**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.suporte.yml \
  --env-file .env.production build --no-cache api

docker compose -f docker-compose.prod.yml -f docker-compose.suporte.yml \
  --env-file .env.production up -d api
```

**Disco cheio no build (`ERR_PNPM_ENOSPC`):**

```bash
df -h
docker system prune -af
docker builder prune -af
```

---

## Atualização (nova versão)

1. **PC:** `./scripts/build-prod-images.sh` → `scp` do `.tar.gz`
2. **Servidor:**
   ```bash
   cd /opt/estoque-teep
   git pull
   ./scripts/load-prod-images.sh /tmp/teep-prod-images.tar.gz
   ```

Postgres/Redis sobem do compose (não precisam rebuild). Só `api` e `web` vêm do tar.

---

## O que não fazer

- `docker-compose.prod.yml` **sozinho** (Caddy briga com Apache na 80/443).
- `SMTP_PASS=` no `.env.production` se a senha tiver `$` (use `SMTP_PASS_B64`).
- Usar MySQL/Postgres do host.
- Commitar `.env.production`.

---

## Referência rápida

| Item | Valor |
|------|--------|
| Código | `/opt/estoque-teep` |
| Web local | `127.0.0.1:3000` |
| API local | `127.0.0.1:4000` |
| Compose | `docker-compose -f docker-compose.prod.yml -f docker-compose.suporte.yml` |
| Vhost Apache | `deploy/apache-suporte-vhosts.conf` |
