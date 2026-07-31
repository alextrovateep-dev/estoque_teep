# F15 — Novo Lançamento unificado

**Status:** implementado.  
**Plano arquitetural:** D26 (revisado), D55; fase F15.

## Decisão

| Tela | Papel |
|------|--------|
| **Novo Lançamento** | Única criação. Tipo do cadastro = ENTRADA / SAÍDA / TRANSFERÊNCIA. |
| **Transferências** | Só verificação e **confirmação de recebimento** (sem “Nova”). |
| **Linha do Tempo** | Histórico. |

Na TRANSFERÊNCIA, no lançamento:

1. **Creditar destino agora** (`creditoDestino: IMEDIATO`)
2. **Aguardar confirmação** (`AGUARDAR_RECEBIMENTO`) — concretiza em Transferências

## API

`POST /movimentacoes` aceita tipo TRANSFERÊNCIA + `filialDestinoId` + `creditoDestino`.

`POST /transferencias` permanece para API/compat; a UI não cria mais por ali.

Transferência **pode** exigir aprovação (`requerAprovacao` no tipo): Operador cria
carga `PENDENTE_APROVACAO` (sem baixar estoque, mas a qty fica **reservada** no
cálculo de disponível); Gerente/Admin aprova em **Aprovações** e aí aplica saída
da origem (e crédito imediato, se escolhido). Rejeição grava `motivoRejeicao` e
libera a reserva. `POST /transferencias` legado segue a mesma regra do tipo
“Transferência entre estoques”.

## Seed

Tipo **Transferência entre estoques** (`sistema: false`, permitido Operador/Gerente) para aparecer no lançamento.
