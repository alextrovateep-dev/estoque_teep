# Assistente de estoque (LLM)

**Status:** implementado.  
**UI:** painel no `/dashboard` (`AssistenteEstoque`) — não é widget global.  
**Permissão:** `assistente` (exige também `dashboard`).

---

## Ideia

Perguntas em PT-BR (saldo, movimentações, alertas, “como faço”).  
Um agente com **tool-calling**. Números **só** das tools no servidor. Sem SQL livre. Sem inventar saldo. Não cria lançamento.

```text
Usuário → POST /assistente/chat (JWT)
  → LLM + tools Prisma (authz do usuário)
  → resposta PT-BR + suggestedLinks (allowlist no servidor)
```

Flag: `ASSISTENTE_LLM_ENABLED=1`. Off → `/assistente/status` e o painel avisam; o resto do Dashboard segue.

Escopo: **somente TEEP Estoque** (não é IA de uso geral). Pedidos e Transformação: orientar para a tela, sem inventar dados via tool.

---

## Tools (leitura)

| Tool | Função | Permissão |
|------|--------|-----------|
| `list_products` / `search_products` | Catálogo / busca | — |
| `list_product_trees` / `get_product_tree` | BOM | — |
| `get_product_stock` / `list_product_series` | Saldos / N/S | — |
| `list_stock_by_value` | Ranking valor em estoque | `dashboard_kpi_valor` |
| `list_stock_movements` | Lista detalhada (máx. 50) | — |
| `rank_product_movements` | Ranking qty no período | — |
| `get_inventory_balance` | KPIs + alertas (mascara KPIs) | — |
| `get_partner_products` / `get_product_partners` | Histórico parceiro×produto (escopo filial do OPERADOR) | — |
| `list_transfers` | Cargas da tela Transferências | `transferencias` |
| `list_rma_processes` / `get_rma_process` | Processos RMA | `rma` |
| `export_produtos_report` / `export_saldos_report` / `export_arvore_report` | PDF/Excel | `relatorios` (+ valor quando aplicável) |
| `export_movimentacoes_report` | PDF/Excel de movimentações | `movimentacoes` **ou** `relatorios` |
| `export_product_report` | Dossiê de um produto | — |
| `prepare_transfer` | Atalho Novo Lançamento (não executa) | `lancamentos` |

Downloads: token one-shot (Redis se disponível; senão memória local) → `GET /assistente/export/:token`.

### Navegação

- Movimentações ficam em `/relatorios?aba=movimentacoes` (não há menu separado).
- Allowlist do assistente espelha o AppShell (`relatorios` **ou** `movimentacoes` liberam Relatórios).

### Ranking de saídas (regra crítica)

- “Mais saída esse mês” → `rank_product_movements` com `periodo=mes_atual` e `sentido=saida`.
- `sentido=saida` = badge **SAÍDA** da tela Movimentações (exclui transferência e tipo sistema).
- Datas: preferir `periodo=mes_atual|mes_passado|hoje` (America/Sao_Paulo). Nunca `dd/mm/aaaa`.

No TEEP, **filial = estoque**. Authz: OPERADOR nos estoques vinculados (sincronizados do DB no middleware); GERENTE/ADMIN podem filtrar mais amplo.

---

## Provider (env)

```env
ASSISTENTE_LLM_ENABLED=0
LLM_PROVIDER=openai   # ou anthropic
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_MODEL=            # default gpt-4o-mini / claude-haiku-4-5-20251001
LLM_MAX_TOOL_ROUNDS=5
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=800
REDIS_URL=            # opcional — compartilha tokens de export entre réplicas
```

Compose prod já encaminha as principais; ver `deploy/env.production.example`.

---

## UX

- Chat no Dashboard; respostas do assistente renderizam Markdown leve.
- Órbita do logo só enquanto a IA processa.
- Links sugeridos só da allowlist do servidor.
- Histórico no `sessionStorage`; conteúdo `assistant` do cliente **não** é fonte de números (servidor marca como não confiável).
