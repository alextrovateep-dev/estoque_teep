# Assistente de estoque (LLM)

**Status:** implementado.  
**UI:** painel no `/dashboard` (`AssistenteEstoque`) — não é widget global.  
**Permissão:** `assistente` (e flag de servidor).

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

---

## Tools (leitura)

| Tool | Função |
|------|--------|
| `list_products` / `search_products` | Catálogo / busca |
| `list_product_trees` / `get_product_tree` | BOM |
| `get_product_stock` | Saldos por estoque |
| `list_stock_by_value` | Ranking valor em estoque |
| `list_stock_movements` | Lista (máx. 50); inclui `papelParceiro` / `parceiroNome` |
| `rank_product_movements` | Ranking qty no período |
| `get_inventory_balance` | KPIs + alertas min/máx |
| `get_partner_products` / `get_product_partners` | Histórico parceiro×produto |
| `list_rma_processes` | Processos RMA (abertos, etapa, cliente) — **não** saldo do estoque RMA |
| `get_rma_process` | Detalhe de um processo + atalho `/rma/:id` |
| `export_*_report` | PDF/Excel (token curto → `GET /assistente/export/:token`) |
| `prepare_transfer` | Atalho (não executa; abre Novo Lançamento) |

### Processos RMA vs estoque RMA

- **Processo RMA** (manutenção): `list_rma_processes` / `get_rma_process`. “Abertos/pendentes” → `status=ABERTO`. Exige permissão `rma`.
- **Estoque com sigla RMA** (saldo): tools de estoque com `filialSigla=RMA`.
- Só leitura — o assistente **não** cria/altera RMA.

### Ranking de saídas (regra crítica)

- “Mais saída esse mês” → `rank_product_movements` com `periodo=mes_atual` e `sentido=saida`.
- `sentido=saida` = badge **SAÍDA** da tela Movimentações (exclui transferência e tipo sistema).
- **Não** usar `list_stock_movements` + `operacao=SAIDA` como substituto (ledger inclui Transferência Enviada).
- **Não** usar `somenteAbertos` para ranking do mês (é fluxo demo/comodato).
- Empate: `empateNoTopo` + `empatadosNoTopo` (`campeao=null`) — a IA deve citar o empate.
- Datas: preferir `periodo=mes_atual|mes_passado|hoje` (fuso America/Sao_Paulo). Nunca `dd/mm/aaaa`.

No TEEP, **filial = estoque**. Authz: OPERADOR nos estoques vinculados; GERENTE/ADMIN podem filtrar mais amplo.

---

## Provider (env)

```env
ASSISTENTE_LLM_ENABLED=0
LLM_PROVIDER=openai   # ou anthropic
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_MODEL=            # default gpt-4o-mini / claude-haiku-4-5-20251001
LLM_MAX_TOOL_ROUNDS=5
LLM_TEMPERATURE=0.45
LLM_MAX_TOKENS=800
```

Compose prod já encaminha as principais; ver `deploy/env.production.example`.

---

## UX

- Chat no Dashboard; textarea **não** usa `disabled` no busy (evita perder foco / scroll da página).
- Links sugeridos só da allowlist do servidor.
- Export: tool gera token; front baixa via `/assistente/export/...`.

---

## API

| Método | Path |
|--------|------|
| `GET` | `/assistente/status` |
| `POST` | `/assistente/chat` |
| `GET` | `/assistente/export/:token` |

Código: `apps/api/src/services/assistente/` · smoke ranking: `apps/api/scripts/smoke-rank-saidas.ts`.

---

## Limites conscientes

- Só leitura (não cria lançamento via LLM).  
- Rate limit no chat: **20 req/min** por usuário (`express-rate-limit`).  
- Papel do parceiro: prompt + campo `papelParceiro` nas tools de movimentação (Compra → fornecedor; Venda → cliente).  
