# Alertas, notificações e e-mail — orientação

**Status:** F9 + F9.1 em produção. Fase 2: transferência (pendente / decisão) e RMA (aberto / financeiro / encerrado) no fanout. Canal de retorno (demo/comodato): sino via fanout sem e-mail duplicado; e-mail só pela lista do lançamento.

**Orientação de arquitetura:** programador **Alex Trova** (padrão operacional mesclado com o F9 do TEEP).

Documento irmão no plano arquitetural: decisões **D35–D40**; fase **F9.1**.

---

## 1. Fluxo padrão (F9.1)

```
evento de domínio
  → emitirNotificacaoEvento
  → usuários ativos com tick do evento (alertasEmail[tipo] === true)
  → grava Notificacao (dedup 5 min)
  → Socket.io "alerta" → toast + sino
  → se tryEmail !== false
       E receberAlertasEmail
       E tipo ∈ allowlist
       → builder → fila SMTP
```

| Preferência | Controla |
|-------------|----------|
| Tick do evento (`alertasEmail`) | Sino / toast (pré-requisito do e-mail do fanout) |
| Master `receberAlertasEmail` | E-mail do fanout (estoque, preço, divergência, transferência, RMA) |
| Senha provisória | Sempre e-mail; fora do opt-in |

**DoD:** e-mail não atrasa POST; usuário sem tick não entra no fanout; falha de SMTP não apaga a notificação.

---

## 2. Eventos

| Evento | Sino (tick) | E-mail | Origem |
|--------|-------------|--------|--------|
| `ESTOQUE_MINIMO` | Sim | Fanout se master ligado | Movimentação / transferência |
| `ESTOQUE_MAXIMO` | Sim | Fanout se master ligado | Idem |
| `PRECO_AJUSTADO` | Sim | Fanout se master ligado | Patch produto |
| `DIVERGENCIA_TRANSFERENCIA` | Sim | Fanout se master ligado | Recebimento com divergência |
| `ALERTA_RETORNO_MOVIMENTACAO` | Sim (tick) | **Só** lista `emailsDestino` do lançamento | Job de agenda |
| `TRANSFERENCIA_PENDENTE_APROVACAO` | Sim | Fanout se master ligado | Criação com status pendente |
| `TRANSFERENCIA_APROVADA` | Sim (+ criador no sino) | Fanout se master ligado | Aprovação |
| `TRANSFERENCIA_REJEITADA` | Sim (+ criador no sino) | Fanout se master ligado | Rejeição |
| `RMA_ABERTO` | Sim | Fanout se master ligado | Abertura do processo |
| `RMA_FINANCEIRO` | Sim | Fanout se master ligado | Patch financeiro |
| `RMA_ENCERRADO` | Sim | Fanout se master ligado | Fechamento ou cancelamento |
| `ACESSO_SENHA_PROVISORIA` | Não | Sempre | Criar / reset usuário |

### Alerta de retorno (regra especial)

1. Fanout com `tryEmail: false` → quem tem o tick vê no **sino** (sem e-mail pelo fanout).
2. E-mail operacional → destinatários únicos em `emailsDestino` (lista digitada no lançamento), independente de `receberAlertasEmail`.
3. Assim não há e-mail duplicado quando o mesmo endereço está no cadastro e na lista.

### Transferência — decisão

Além do fanout (ticks), o **criador** da transferência recebe aviso no sino via `createInAppNotification` (aprovada/rejeitada), mesmo sem o tick.

`createInAppNotification(usuarioId, …)` — destinatário único, só DB + socket (sem consultar ticks). Usar quando o aviso é pontual a um usuário.

---

## 3. Princípios (D35+)

1. **Build ≠ Send** — builders montam; um serviço SMTP.
2. **Notificação = DB + realtime** — e-mail opcional/async.
3. **Só canal transacional** — sem marketing.
4. **Admin first** — samples, preview, `[TESTE]` em `/admin/email`.
5. **Dedup** — mesmo usuário + tipo + `dedupeKey` em 5 minutos.

---

## 4. Pacote de e-mail

```
apps/api/src/
  lib/mailIdentity.ts
  services/EmailService.ts
  services/NotificationService.ts
  services/notificationEmailEnabledTypes.ts
  services/email/
    builders/
```

Env: `SMTP_*`, `EMAIL_FROM_TRANSACTIONAL`, `EMAIL_REPLY_TO`, `EMAIL_SUPPORT`, `FRONTEND_URL`.

---

## 5. API in-app

- `GET /notificacoes`
- `PATCH /notificacoes/:id/lida`
- `POST /notificacoes/marcar-todas-lidas`
- UI: `NotificationBell` no shell + toast via socket

---

## 6. Do / Don’t

**Do:** normalizar destinatário; logar identidade; opt-in no fanout; testes allowlist ↔ builders.

**Don’t:** HTML na rota; Nodemailer no builder; bloquear HTTP no SMTP; marketing.

---

## 7. Backlog (próximas fases)

- Redis adapter no Socket.io se multi-instância
- Deep link no sino a partir de `meta.href`

> **Nota:** `filial` no TEEP é **estoque** (local de saldo), não unidade organizacional. O fanout por preferência do usuário já cobre os dois casos (operação / gestão); não há escopo “por unidade” a filtrar.

---

## 8. Relação com o plano

| Decisão | Resumo |
|--------|--------|
| D35 | Notificação DB-first; e-mail opcional async |
| D36 | Build ≠ Send |
| D37 | Só transacional |
| D38 | Allowlist tipada |
| D39 | Admin preview + `[TESTE]` |
| D40 | Dedup anti-spam |

Checklist: [F10-homologacao-checklist.md](./F10-homologacao-checklist.md).
