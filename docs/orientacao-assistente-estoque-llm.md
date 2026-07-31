# Orientação — Assistente de Estoque (LLM)

**Status:** **implementado** (F14) — consulta em linguagem natural no Dashboard.  
**Orientação:** programador **Alex Trova** (padrões de contrato rígido, tools autenticadas, feature flag, modelo barato).

Decisões: **D48–D54** (plano arquitetural).

---

## 1. Ideia

Usuário pergunta no Dashboard (PT-BR): saldo, movimentações, alertas, “como faço”.  
Um **único agente LLM** com **tool-calling**. Números **só** vindos das tools (servidor). Sem SQL livre. Sem inventar saldo.

Superfície UX: painel embutido em `/dashboard` (não widget global).

---

## 2. Arquitetura

```
Usuário → POST /assistente/chat (JWT)
  → agente LLM + tools Prisma
  → resposta PT-BR + suggestedLinks (allowlist por perfil)
```

Flag: `ASSISTENTE_LLM_ENABLED=1`. Se off → API informa desligado; Dashboard mostra estado sem quebrar.

---

## 3. Tools (só leitura)

| Tool | Função |
|------|--------|
| `list_products` | Catálogo / ranking por preço |
| `search_products` | Busca por código/descrição (+ preço) |
| `get_product_stock` | Saldos por filial |
| `list_stock_movements` | Últimas movimentações (máx. 50) |
| `get_inventory_balance` | KPIs + alertas min/máx |

System prompt inclui **mapa curto** entidade ↔ tool (sem SQL livre).

Authz: OPERADOR sempre na própria filial; GERENTE/ADMIN podem filtrar `filialId`.

---

## 4. Provider

Env:

```
ASSISTENTE_LLM_ENABLED=0
LLM_PROVIDER=openai|anthropic
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_MODEL=          # default: gpt-4o-mini / claude-haiku-4-5-20251001
LLM_MAX_TOOL_ROUNDS=3
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=800
```

Troca de provider por custo sem mudar o resto do código.

---

## 5. UX shell (mesmo corte)

Header estilo Instagram: **avatar | nome** + **sino** com ponto vermelho se houver não lidas; clique abre lista (F9.1).

---

## 6. Decisões

| Id | Resumo |
|----|--------|
| D48 | Um agente + tools; sem router FAQ no MVP |
| D49 | Só leitura; sem criar lançamento via LLM |
| D50 | Painel no Dashboard (não bolha global) |
| D51 | Provider trocável OpenAI/Anthropic por env |
| D52 | suggestedLinks só da allowlist do servidor |
| D53 | Rate limit por usuário + feature flag |
| D54 | Header Instagram: avatar+nome+sino com dot vermelho |

---

## 7. DoD

- Painel no `/dashboard`  
- Tools de leitura + authz + mapa curto no prompt  
- Flag e troca de provider  
- Shell Instagram  
- Typecheck ok  
