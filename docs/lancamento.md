# Novo Lançamento, transferências e aprovações

**Status:** implementado (ex-F15).  
**Telas:** `/lancamentos/novo` · `/transferencias` · `/transferencias/[id]` · `/aprovacoes` · `/movimentacoes`

---

## Papéis das telas

| Tela | Papel |
|------|--------|
| **Novo Lançamento** | Única criação de ENTRADA / SAÍDA / TRANSFERÊNCIA (tipo do cadastro) |
| **Transferências** | Lista + detalhe: acompanhar e **conferir recebimento** (sem criar) |
| **`/transferencias/nova`** | Redirect → `/lancamentos/novo` |
| **Aprovações** | Fila: movimentações `PENDENTE` e transferências `PENDENTE_APROVACAO` |
| **Movimentações** | Histórico / ledger (menu: “Movimentações”, não “Linha do Tempo”) |

---

## Novo Lançamento — o que o sistema faz

1. Escolhe **tipo** (`operacao`: ENTRADA | SAIDA | TRANSFERENCIA).
2. **Multi-SKU** (padrão): várias linhas produto + qtd/séries → `POST /movimentacoes` com `itens[]`; API agrupa em `grupoLancamentoId`.
3. **Exceções (uma linha / fluxo especial):**
   - tipo **retorno** (`ehRetornoDeId`) — vínculo à saída, NF número + anexo obrigatórios;
   - tipo **baixa por árvore** (`baixaPorArvore`) — explode BOM (ver [arvore-produto.md](./arvore-produto.md)).
4. Flags do tipo: `requerCliente`, `geraAlertaRetorno`, `requerTermoComodato`, `requerAprovacao`, séries, etc.

### Transferência no lançamento

Obrigatório: `filialDestinoId` ≠ origem + `creditoDestino`:

| Valor | Efeito |
|-------|--------|
| `IMEDIATO` | Credita destino na aplicação da saída |
| `AGUARDAR_RECEBIMENTO` | Carga em trânsito; saldo no destino na **conferência** em Transferências |

UI também envia `guiaTransporte` (opcional). Prefill: `?transferencia=1` (atalho no front).

### Aprovação

Se o tipo tem `requerAprovacao` e quem lança é Operador:

- Movimentação / transferência fica **pendente** (sem baixar estoque; qty **reservada** no disponível).
- Gerente/Admin aprova ou rejeita em **Aprovações** (`POST /movimentacoes/:id/aprovar|rejeitar` ou `/transferencias/:id/aprovar|rejeitar`).
- Rejeição: `motivoRejeicao` + libera reserva.

---

## API

| Uso | Endpoint |
|-----|----------|
| Criar (UI) | `POST /movimentacoes` — item único **ou** `itens[]`; transferência + `filialDestinoId` + `creditoDestino` |
| Compat | `POST /transferencias` — ainda existe; UI **não** cria por ali |
| Conferir | `POST /transferencias/:id/conferir` |
| Aprovar / rejeitar | sob `/movimentacoes/...` e `/transferencias/...` |

Schema: `createMovimentacaoSchema` em `packages/shared`.

---

## Seed

Tipo **Transferência entre estoques** (`sistema: false`, Operador/Gerente) para aparecer no lançamento.  
Smoke: `pnpm smoke:f10` (aguardar) · `pnpm smoke:extra` (imediato) · `apps/api/scripts/smoke-multi-lancamento.ts` (multi-SKU).

---

## Fora deste doc

- Geração de série na entrada → [geracao-numero-serie.md](./geracao-numero-serie.md)
- RMA → [rma.md](./rma.md)
- Alertas de transferência → [alertas-email.md](./alertas-email.md)
