# Instalação no servidor TechCenter

**Status:** adiado — executar só quando for a hora de instalar lá.  
**Host:** `techcenter-teep` · IP `82.29.58.53` · SSH na porta **2222** (não 22).  
**Levantamento de portas:** 17 ago 2026 (`ss -tunap`).  
**Guia genérico:** [INSTALACAO.md](./INSTALACAO.md) (`docker-compose.prod.yml` + `.env.production`).

Não misturar com o software que já roda nesse Linux. Este stack sobe **Postgres e Redis próprios** no Docker (rede `teep`). Não usar o Postgres/Redis já publicados no host.

---

## O que já ocupa o servidor

| Porta no host | Quem | Impacto no Estoque |
|---------------|------|-------------------|
| **80** | `docker-proxy` (stack existente) | **Conflito.** O Caddy padrão do Estoque publica `80:80`. Não subir assim. |
| **443** | livre | Pode ser usada pelo Estoque **ou** pelo proxy atual, se for o caso. |
| 81–84, 8000–8005, 8010, 8035, 8081, 8085, 8086, 8088, 8090, 8236, 8237 | Docker | Não reutilizar. |
| 5434, 5435, 5438, 5444 | Postgres (Docker) | Banco **alheio**. Não apontar `DATABASE_URL` para eles. |
| 6373, 6381, 6382 | Redis (Docker) | Redis **alheio**. Não apontar `REDIS_URL` para eles. |
| 5672, 15672 | RabbitMQ | Irrelevante. |
| 3000 | Grafana | Só atrapalha compose de **dev**. Produção não publica 3000. |
| 2222 | sshd | SSH. Conectar com `-p 2222`. |
| 8080, 8443, 4000 | livres no levantamento | Candidatas se o Estoque não herdar a 80. |

Postgres/Redis do Estoque **não** publicam 5432/6379 no host (compose de produção). Isso não briga com os bancos já instalados.

---

## Decisão obrigatória (antes do `up`)

Escolher **um** caminho. Sem isso o `caddy` falha na 80.

### A — Entrar no proxy que já usa a 80 (preferível em produção)

1. Identificar o que está no `docker-proxy:80` (`docker ps` / Traefik / Nginx / Caddy).
2. Criar dois hosts (DNS A → `82.29.58.53`), por exemplo:
   - `estoque.teep.com.br` → web
   - `api.estoque.teep.com.br` → API
3. No proxy existente: encaminhar esses hosts para os containers `web:3000` e `api:4000` **na rede Docker do Estoque**, **ou** para portas internas publicadas só no localhost.
4. No `docker-compose.prod.yml` do Estoque: **não** publicar `80:80` / `443:443` no serviço `caddy` (ou omitir o Caddy e deixar só o proxy atual).

Let's Encrypt: quem emite o certificado é o proxy da 80, não um segundo Caddy.

### B — Portas próprias (ensaio / sem mexer no proxy)

Publicar o Caddy do Estoque em portas livres, por exemplo:

```yaml
# docker-compose.prod.yml — serviço caddy
ports:
  - "8080:80"
  - "8443:443"
```

Acesso: `https://<host>:8443` (e HTTP em `:8080`). Ajustar `NEXT_PUBLIC_*` e `CORS_ORIGIN` com essa origem (incluindo a porta, se não for 443).

**8080 e 8443 estavam livres** no levantamento. Confirmar de novo com `ss -tlnp` no dia da instalação.

---

## Checklist no dia da instalação

1. SSH: `ssh -p 2222 root@82.29.58.53` (ou o usuário que for).
2. Confirmar Docker Compose v2: `docker compose version`.
3. Repetir `ss -tlnp | grep -E ':80 |:443 |:8080 |:8443 '` — 80 ainda ocupada?
4. Fechar a decisão A ou B acima.
5. Código:
   ```bash
   sudo mkdir -p /opt && sudo chown "$USER:$USER" /opt
   cd /opt
   git clone https://github.com/alextrovateep-dev/estoque_teep.git estoque-teep
   cd estoque-teep
   ```
6. `cp deploy/env.production.example .env.production && chmod 600 .env.production`
7. Secrets (`openssl rand -hex 32` duas vezes; senha Postgres; senha admin). Ver INSTALACAO.md §4.
8. Preencher `WEB_HOST`, `API_HOST`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGIN` de acordo com A ou B.
9. Primeiro boot: `SEED_ON_START=1`. Depois `0` (INSTALACAO.md §4.3).
10. Build (se RAM apertada, api e web **um de cada vez** — INSTALACAO.md §5.3):
    ```bash
    docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
    ```
11. `curl` no `/health` da API pública; login; **trocar senha do admin**.
12. Não apontar este sistema para os Postgres 5434/5435/5438/5444 nem Redis 6373/6381/6382.

---

## O que não fazer

- Segundo Caddy na porta **80** enquanto o stack atual estiver nela.
- Reusar volume/banco do outro software.
- Compose de desenvolvimento (`docker-compose.yml`) neste servidor (publica 5432/6379/3000/4000).
- Commitar `.env.production`.

---

## Depois de instalado (atualização)

```bash
cd /opt/estoque-teep
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
