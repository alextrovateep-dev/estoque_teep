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
| `list_products` | Catálogo / ranking por preço de tabela |
| `search_products` | Busca por código/descrição (+ preço) |
| `list_product_trees` / `get_product_tree` | BOM / árvore |
| `get_product_stock` | Saldos por estoque |
| `list_stock_by_value` | Ranking valor em estoque (qty×preço) |
| `list_stock_movements` | Lista detalhada (máx. 50); transferência / demo / comodato |
| `rank_product_movements` | **Ranking** por qty no período (`mes_atual` / `mes_passado` / `hoje`) |
| `get_inventory_balance` | KPIs + alertas min/máx |
| `get_partner_products` / `get_product_partners` | Histórico cliente×produto |
| `export_*_report` | PDF/Excel (produtos, saldos, árvore, dossiê) |
| `prepare_transfer` | Atalho de transferência (não executa; abre Novo Lançamento) |

### Saídas no período (cuidado)

- Pergunta “mais saída esse mês” → **`rank_product_movements`** com `periodo=mes_atual` e `sentido=saida`.
- `sentido=saida` = badge **SAÍDA** da tela Movimentações (Venda/Entrega etc.): exclui transferência entre estoques e baixa automática de componente.
- **Não** usar `list_stock_movements` + `operacao=SAIDA` como substituto: no ledger, Transferência Enviada também é `SAIDA` (na tela vira badge TRANSF.).
- **Não** usar `somenteAbertos=true` (isso é só demo/comodato ainda fora).
- Empate no topo: a tool devolve `empateNoTopo` + `empatadosNoTopo` (`campeao=null`); a IA deve citar o empate.

No TEEP, **filial = estoque** (local de saldo), não unidade organizacional.

System prompt inclui mapa entidade ↔ tool, janelas de hoje/mês (America/Sao_Paulo) e tom conversacional.

Authz: OPERADOR na própria filial/estoques vinculados; GERENTE/ADMIN podem filtrar.
---

## 4. Provider

Env:

```
ASSISTENTE_LLM_ENABLED=0
LLM_PROVIDER=openai|anthropic
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_MODEL=          # default: gpt-4o-mini / claude-haiku-4-5-20251001
LLM_MAX_TOOL_ROUNDS=5
LLM_TEMPERATURE=0.45
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
- Ranking de saídas/entradas por período (`rank_product_movements`) alinhado ao badge da tela  
- Flag e troca de provider  
- Shell Instagram  
- Typecheck ok  
