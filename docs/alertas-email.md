# Alertas, notificações e e-mail

**Status:** implementado (sino + fanout + templates admin + transferência/RMA).  
**UI:** sino no header (`NotificationBell`) · Admin → **E-mail** (`/admin/email`) · ticks no cadastro de usuário.

---

## Fluxo padrão

```text
evento de domínio
  → emitirNotificacaoEvento
  → usuários ativos com tick do evento (alertasEmail[tipo] === true)
  → grava Notificacao (dedup 5 min: usuário + tipo + dedupeKey)
  → Socket.io "alerta" → toast + sino
  → se tryEmail !== false
       E receberAlertasEmail
       E tipo ∈ allowlist (ALERTA_EMAIL_TYPES)
       → builder → fila SMTP (não bloqueia o POST)
```

| Preferência | Controla |
|-------------|----------|
| Tick do evento (`alertasEmail`) | Entrar no fanout (sino/toast); pré-requisito do e-mail do fanout |
| Master `receberAlertasEmail` | E-mail do fanout |
| Senha provisória | Sempre e-mail; **fora** do opt-in de alertas |

`createInAppNotification(usuarioId, …)` — destinatário único, só DB + socket (`tryEmail: false`). Usado p.ex. para o **criador** da transferência na aprovação/rejeição.

---

## Eventos (`ALERTA_EVENTOS`)

| Evento | Sino (tick) | E-mail | Origem típica |
|--------|-------------|--------|----------------|
| `ESTOQUE_MINIMO` / `ESTOQUE_MAXIMO` | Sim | Fanout se master | Movimentação / transferência |
| `PRECO_AJUSTADO` | Sim | Fanout se master | Patch produto |
| `DIVERGENCIA_TRANSFERENCIA` | Sim | Fanout se master | Conferência com divergência |
| `ALERTA_RETORNO_MOVIMENTACAO` | Sim | **Só** lista `emailsDestino` do lançamento | Job de agenda |
| `TRANSFERENCIA_PENDENTE_APROVACAO` | Sim | Fanout se master | Criação pendente |
| `TRANSFERENCIA_APROVADA` / `_REJEITADA` | Sim (+ criador no sino) | Fanout se master | Decisão em Aprovações |
| `RMA_ABERTO` / `RMA_FINANCEIRO` / `RMA_ENCERRADO` | Sim | Fanout se master | Processo RMA |
| `ACESSO_SENHA_PROVISORIA` | Não | Sempre | Criar / reset usuário (tipo **conta**) |

### Retorno (demo/comodato) — regra especial

1. Fanout com `tryEmail: false` → tick vê no **sino** (sem e-mail pelo fanout).  
2. E-mail operacional → destinatários em `emailsDestino` do lançamento (independente de `receberAlertasEmail`).  
3. Evita e-mail duplicado se o mesmo endereço está no cadastro e na lista.

---

## Pacote (código)

```text
apps/api/src/
  lib/mailIdentity.ts · mailDeliver.ts
  services/NotificationService.ts
  services/EmailService.ts
  services/notificationEmailEnabledTypes.ts
  services/alertaService.ts
  services/email/   (builders, templates, emailTypes)
```

Env: `SMTP_*`, `EMAIL_FROM_TRANSACTIONAL`, `EMAIL_REPLY_TO`, `EMAIL_SUPPORT`, `FRONTEND_URL` / `CORS_ORIGIN`.  
Sem SMTP → log `[email:dev]`.

Admin: listar templates, preview, salvar, reset, envio **`[TESTE]`**.

---

## API in-app

- `GET /notificacoes`
- `PATCH /notificacoes/:id/lida`
- `POST /notificacoes/marcar-todas-lidas`

---

## Do / Don’t

**Do:** opt-in no fanout; allowlist tipada; falha SMTP não apaga a notificação.  
**Don’t:** HTML na rota de negócio; bloquear HTTP esperando SMTP; marketing.

---

## Backlog

- Redis adapter no Socket.io se multi-instância API  
- Deep link no sino a partir de `meta.href` (campo ainda pouco usado na UI)

> `filial` no TEEP = **estoque** (local de saldo), não unidade organizacional. Fanout é por preferência do usuário, não “por filial”.
