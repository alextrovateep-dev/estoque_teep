# Pedidos de venda (eGestor)

**Status:** implementado.  
**Telas:** `/pedidos` · `/pedidos/[id]`  
**Cadastros:** Admin → Estoques (flag acabados) · Admin → Tipos (flag saída de pedido)

Integração **somente leitura** com a API de vendas do eGestor. O TEEP nunca cria, altera nem cancela pedido no eGestor.

---

## O que entra na fila

Sincroniza só o que no eGestor está **ao mesmo tempo**:

- **Venda ou orçamento?** = Orçamento (`situacao = 10`)
- **Situação** = Em espera (`situacaoOS = "Em espera"`)

Pedido já virado venda (`situacao = 50`) não entra, mesmo em espera.

A listagem oficial usa `tipo=10` (orçamento) e `situOS=Em espera` (não o query `situacao` do dump interno).

Só pedidos com **data de cadastro (`dtCad`) ou data do pedido (`dtVenda`) a partir de 01/08/2026**. Orçamentos antigos saem da fila **Em aberto** no próximo sync. Override: `EGESTOR_SYNC_DT_INI=YYYY-MM-DD`.

Só linhas de **produto**. Na API real o campo da linha é `tipo` (`produto` | `servico`); o dump interno chamava `tipoProd`. Os dois são aceitos. Orçamento/OS **só de serviço** não entra.

**Não entra** (e some da fila **Em aberto** se já estava no TEEP): Finalizada, Entregue, Em execução, Cancelada, faturadas, e pedidos sem nenhuma linha de produto.

Pedido já **Separado** no TEEP **permanece** (histórico da baixa de estoque). O sync deixa de atualizar as linhas.

O dump `openapi-egestor.yaml` do repo diverge da [documentação oficial](https://github.com/eGestor/documentacao-api): linhas usam `tipo`, listagem usa `tipo`/`situOS`. O sync segue a API oficial.

---

## Cadastros necessários

1. **Estoque de acabados** — no cadastro do estoque (filial), marcar **Estoque de acabados**. Pode haver vários. Sem o flag, o estoque não aparece na separação.
2. **Tipo de saída** — um tipo `SAIDA` com a flag **Saída de pedido de venda** (no máximo um ativo). A tela de pedidos usa esse tipo; o operador **não** escolhe tipo. Sem tipo ativo, Separar fica bloqueado.

Match de SKU: `codigoProprio` da linha eGestor = `Produto.codigo` no TEEP. Linha sem match aparece na tela e **impede** concluir a separação.

---

## Telas

| Tela | Papel |
|------|--------|
| **Pedidos** (`/pedidos`) | Abas Em aberto / Separados. Botão **Atualizar do eGestor**. |
| **Detalhe** (`/pedidos/[id]`) | Itens, escolha **um** estoque de acabados para o pedido inteiro, séries (fluxo padrão de saída), destinatários, Separar. |

Permissão: `pedidos` (Gerente e Operador por padrão).

Operador só separa em acabados aos quais está vinculado. Gerente/Admin: qualquer acabado ativo.

---

## Separação

1. Pedido `ABERTO`; todos os itens com produto TEEP; quantidades iguais às do eGestor.
2. Escolhe o acabado; informa série quando o produto controla série (`POST /series/validar-saida`).
3. Marca usuários que recebem e-mail (IDs do cadastro, não lista livre).
4. API chama `criarMovimentacao` (SAÍDA padrão: saldo + séries), sempre com `grupoLancamentoId` (também em pedido de 1 SKU). Linhas do mesmo produto são agrupadas.
5. Status TEEP `ABERTO` → `SEPARADO`. eGestor **não** muda.

Se o tipo de saída **exige aprovação** e quem separa é Operador, a movimentação fica `PENDENTE`. O pedido **só** vai para Separado quando a saída for aprovada. Rejeição libera o pedido para separar de novo.

---

## API

| Uso | Endpoint |
|-----|----------|
| Lista | `GET /pedidos?status=ABERTO\|SEPARADO` |
| Detalhe | `GET /pedidos/:id` |
| Acabados | `GET /pedidos/estoques-acabados` |
| Destinatários | `GET /pedidos/usuarios-destinatarios` |
| Sync agora | `POST /pedidos/sync` |
| Separar | `POST /pedidos/:id/separar` |

Body de separar: `filialId`, `destinatarioIds` (mín. 1), `itens: [{ id, quantidade, series? }]`.

---

## Ambiente

| Variável | Uso |
|----------|-----|
| `EGESTOR_PERSONAL_TOKEN` | Token OAuth pessoal (obrigatório para sync) |
| `EGESTOR_BASE_URL` | Padrão `https://v4.egestor.com.br/api` |
| `EGESTOR_SYNC` | `0` desliga o job |
| `EGESTOR_SYNC_INTERVAL_MS` | Padrão 5 min |
| `EGESTOR_SYNC_DT_INI` | Padrão `2026-08-01` — lê só pedidos com `dtCad` ou `dtVenda` a partir desta data |

Token vazio: job no-op (log). Rate limit eGestor: **60 req/min**; páginas de 50. O cliente serializa as chamadas, respeita ~1,1 s entre elas e, em HTTP 429, espera e tenta de novo (até 8 vezes). Clique em Atualizar enquanto o job roda reaproveita o sync em andamento (não dispara outra varredura).

Job no boot (`setInterval`), mesmo padrão dos alertas de retorno.

---

## Seed (homologação)

Com `SEED_DEMO=1`: estoques PLN/TBO como acabados; tipo **Saída pedido eGestor** com a flag de saída de pedido.

---

## Fora deste módulo (v1)

Escrever no eGestor, NF, reserva no eGestor, acabado **por item**, webhook.
