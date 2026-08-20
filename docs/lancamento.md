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

1. Escolhe **só o tipo** (`operacao`: ENTRADA | SAIDA | TRANSFERENCIA). O **estoque** (e origem/destino na transferência) vem **amarrado no cadastro do tipo** — a UI só exibe, não escolhe.
2. **Multi-SKU** (padrão): várias linhas produto + qtd/séries → `POST /movimentacoes` com `itens[]`; API agrupa em `grupoLancamentoId`.
3. **Exceções (uma linha / fluxo especial):**
   - tipo **retorno** (`ehRetornoDeId`) — vínculo à saída, NF número + anexo obrigatórios;
   - tipo **baixa por árvore** (`baixaPorArvore`) — explode BOM (ver [arvore-produto.md](./arvore-produto.md)).
4. Flags do tipo: `requerCliente`, `geraAlertaRetorno`, `requerTermoComodato`, `requerAprovacao`, séries, etc.

Tipos sem `filialId` (e, em transferência, sem `filialDestinoId`) **não aparecem** em `paraLancamento=1` e a API rejeita o lançamento até o admin completar o cadastro. Tipos sistema / RMA / saída pedido eGestor não usam essa amarração (filial vem do fluxo interno).

### Transferência no lançamento

Obrigatório no tipo: origem ≠ destino. No lançamento: `creditoDestino`:

| Valor | Efeito |
|-------|--------|
| `IMEDIATO` | Credita destino na aplicação da saída |
| `AGUARDAR_RECEBIMENTO` | Carga em trânsito; saldo no destino na **conferência** em Transferências |

UI também envia `guiaTransporte` (opcional). Prefill: `?transf=1` (atalho); com `origem`/`destino` escolhe o tipo TRANSFERENCIA cuja rota bate.

### Aprovação

Se o tipo tem `requerAprovacao` e quem lança é Operador:

- Movimentação / transferência fica **pendente** (sem baixar estoque; qty **reservada** no disponível).
- Gerente/Admin aprova ou rejeita em **Aprovações** (`POST /movimentacoes/:id/aprovar|rejeitar` ou `/transferencias/:id/aprovar|rejeitar`).
- Rejeição: `motivoRejeicao` + libera reserva.

---

## API

| Uso | Endpoint |
|-----|----------|
| Criar (UI) | `POST /movimentacoes` — `tipoId` (filiais do tipo); item único **ou** `itens[]`; transferência + `creditoDestino` |
| Compat | `POST /transferencias` — ainda existe; UI **não** cria por ali |
| Conferir | `POST /transferencias/:id/conferir` |
| Aprovar / rejeitar | sob `/movimentacoes/...` e `/transferencias/...` |

Schema: `createMovimentacaoSchema` / `tipoMovimentacaoSchema` em `packages/shared`.

---

## Seed

Com `SEED_DEMO=1`: tipos homolog (Compra, Venda, **Transferência PLN → TBO**, etc.) com `codigo` + estoques demo.  
Smoke: `pnpm smoke:f10` · `pnpm smoke:extra` · `apps/api/scripts/smoke-multi-lancamento.ts`.

---

## Fora deste doc

- Geração de série na entrada → [geracao-numero-serie.md](./geracao-numero-serie.md)
- RMA → [rma.md](./rma.md)
- Alertas de transferência → [alertas-email.md](./alertas-email.md)
