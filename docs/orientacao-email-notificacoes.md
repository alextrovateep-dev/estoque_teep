# Alertas, notificações e e-mail — orientação de evolução

**Status:** F9 entregue. **F9.1 implementada** (inbox DB-first + pacote e-mail tipado + preview admin).

**Orientação de arquitetura:** programador **Alex Trova** (padrão operacional mesclado com o F9 do TEEP).

Documento irmão no plano arquitetural: decisões **D35–D40**; fase **F9.1**.

---

## 1. O que já existe (F9 — manter)

| Peça | Comportamento |
|------|----------------|
| Preferências por usuário | Ticks `alertasEmail` = inbox/toast; master `receberAlertasEmail` = também e-mail (D33/D35) |
| Eventos fechados | `ESTOQUE_MINIMO`, `ESTOQUE_MAXIMO`, `PRECO_AJUSTADO`, `DIVERGENCIA_TRANSFERENCIA` (D34) |
| Limiares | Produto `estoqueMinimo` / `estoqueMaximo`; `0` = desligado (D31/D32) |
| Side-effect | E-mail **fora** do request path (RNF11); fila Redis com requeue ou envio direto |
| Realtime | Socket.io autenticado (JWT renovável no handshake) → toast |
| Resposta HTTP | Campo `alertas[]` síncrono para o ator da ação |

**DoD F9 (cumprido):** e-mail não atrasa POST; usuário sem tick do evento não recebe fanout.

---

## 2. Princípios da evolução (D35+)

1. **Build ≠ Send** — builders só montam a mensagem; um único serviço fala com SMTP.
2. **Notificação = DB + realtime** — e-mail é canal **opcional** (allowlist tipada + opt-in), async; falha de e-mail **não** desfaz a notificação.
3. **Canal transacional apenas** — sem campanha de marketing, sem fila de blast comercial.
4. **Admin first** — samples, preview HTML, envio com prefixo `[TESTE]` no subject.
5. **Dedup** onde houver risco de spam (mesmo usuário + evento + entidade em janela curta).

---

## 3. Modelo alvo (híbrido)

```
evento de domínio (saldo / preço / divergência)
  → createNotification (Prisma: destinatário, tipo, título, corpo, lida, meta, criadoEm)
  → emit Socket (inbox / toast)
  → se tipo ∈ allowlist e-mail E usuário com opt-in + tick
       → builder → PreparedTransactionalEmail → sendPreparedMail (async / fila)
```

### Fluxos auxiliares

- `createInAppNotification` — só DB + socket (sem e-mail), quando o e-mail já saiu por outro caminho.
- Preferências atuais (D33) **permanecem**; passam a alimentar o gate de e-mail da notificação.

---

## 4. Pacote de e-mail (estrutura alvo)

```
apps/api/src/
  lib/mailIdentity.ts          # From / Reply-To / envelope
  services/EmailService.ts     # único ponto SMTP (Nodemailer)
  services/NotificationService.ts
  services/notificationEmailEnabledTypes.ts   # allowlist tipada
  services/email/
    emailTypes.ts              # union fechada dominio_acao ou ALERTA_EVENTOS
    preparedMail.ts            # PreparedTransactionalEmail
    recipientUtils.ts          # normalizeRecipient (trim + lowercase)
    emailBlocks.ts
    transactionalLayout.ts    # layout compartilhado + escapeHtml
    emailTemplateCatalog.ts    # samples admin
    builders/                  # um builder por tipo / evento
```

### PreparedTransactionalEmail

`{ subject, html, text?, type, attachments? }`

- `type` em union fechada (alinhada a D34 / extensível).
- Novo tipo = atualizar union + catálogo + sample + allowlist.
- Builders: zero HTML solto em controllers/rotas.
- `sendPreparedMail`: logs com `emailType`, from, replyTo, envelopeFrom, messageId, accepted/rejected.
- `sendPreparedEmailAsTest`: subject com `[TESTE]` + header de teste.

### Env a documentar

```
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
EMAIL_FROM_TRANSACTIONAL
EMAIL_REPLY_TO
EMAIL_SUPPORT
FRONTEND_URL   # links nos templates
```

**Fora de escopo TEEP:** `EMAIL_FROM_MARKETING`, campanhas, throttle de blast, status RASCUNHO/ENVIANDO de marketing.

---

## 5. Notificações in-app

### Persistência (proposta)

Tabela `notificacoes` (nome final na migration):

| Campo | Uso |
|-------|-----|
| `id` | UUID |
| `usuarioId` | Destinatário |
| `tipo` | Evento D34 (ou extensão) |
| `titulo` | Curto |
| `mensagem` | Corpo |
| `lida` | boolean |
| `meta` | JSON (produtoId, filialId, transferenciaId, …) |
| `criadoEm` | timestamp |

### API (proposta)

- `GET /notificacoes` — lista do usuário autenticado (paginada)
- `PATCH /notificacoes/:id/lida`
- `POST /notificacoes/marcar-todas-lidas`
- UI: sino no `AppShell` + lista; toast continua via socket

### Regras

- `createNotification`: DB → realtime → `trySendEmail` fire-and-forget.
- Erro de e-mail **não** falha a criação.
- Allowlist tipada dos tipos que disparam e-mail + teste de cobertura switch ↔ allowlist.
- Não disparar e-mail para **todo** tipo in-app — só allowlist + opt-in.

---

## 6. Do / Don’t

**Do**

- Normalizar destinatário no send.
- Logar identidade completa em todo envio.
- Preferir `text` + `html`.
- Opt-in explícito para e-mail de notificação.
- Testes: routing allowlist, mailIdentity, snapshot HTML de ≥1 builder.
- Dedup em rajadas do mesmo evento/entidade.

**Don’t**

- Montar HTML/assunto na rota/controller.
- Nodemailer dentro de builder.
- From de domínio diferente do SMTP auth (alias no mesmo domínio ok).
- Bloquear request HTTP no envio de e-mail.
- Introduzir canal ou fila de marketing neste sistema.

---

## 7. Ordem de implementação (F9.1) — **feita**

1. ~~Migration `notificacoes` + API listar/marcar lida + sino na UI~~  
2. ~~Refatorar fanout → `NotificationService` DB-first (preferências D33)~~  
3. ~~Pacote `email/` (types, layout, builders, `mailIdentity`, `EmailService`)~~  
4. ~~Preview / envio `[TESTE]` na Área Admin (`/admin/email`)~~  
5. ~~Dedup simples + testes allowlist ↔ builders~~  

**Não bloqueia Go-Live A.**

---

## 8. Relação com o plano

| Decisão | Resumo |
|--------|--------|
| D35 | Notificação DB-first; e-mail opcional async |
| D36 | Build ≠ Send; um único send SMTP |
| D37 | Só canal transacional (sem marketing) |
| D38 | Allowlist tipada de tipos com e-mail |
| D39 | Admin: preview + `[TESTE]` |
| D40 | Dedup anti-spam por usuário/evento/entidade |

Checklist homologação geral: [F10-homologacao-checklist.md](./F10-homologacao-checklist.md).
