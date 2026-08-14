# RMA — processo e estoque

**Status:** ampliado (checklist por produto, diagnóstico/plano com peças, orçamento, liberação).  
**Telas:** `/rma` · `/rma/novo` · `/rma/[id]` · `/cadastros/rma-checklists`  
**Permissões:** `rma` · `rma_cobranca`

---

## Princípios

1. **Estoque = motor padrão** — transferência/lançamento entre filiais (`Filial`).
2. **Processo = nota** — cliente, NFs, estoque RMA, destinatários, comercial.
3. **Item = manutenção** — checklist, diagnóstico, plano+peças, orçamento, liberação, devolução/troca.
4. **Checklist por produto (SKU)** — templates RECEBIMENTO e LIBERACAO; clonar entre produtos.
5. **Peças previstas no plano** — assistência define serviços/peças; comercial precifica o orçamento.
6. **Tipos de movimentação por flag** — Admin → Tipos: `rmaEntradaEstoque` (abrir RMA / entrada automática) e `rmaSaidaCliente` (devolver/trocar). Não depende mais do nome fixo “Entrada RMA” / “Saída RMA”.

---

## Etapas do item

`AGUARDANDO_RECEBIMENTO` → checklist + diagnóstico/plano/peças → `AGUARDANDO_ORCAMENTO` → enviar orçamento → `AGUARDANDO_APROVACAO` → aprovar → `AGUARDANDO_MANUTENCAO` → manutenção realizada → `AGUARDANDO_LIBERACAO` → checklist liberação → `AGUARDANDO_ENVIO` → Devolver/Trocar → `FINALIZADO`

Recusa do orçamento → `NAO_APROVADO` (devolver/trocar sem manutenção).

Devolver/Trocar só com etapa `AGUARDANDO_ENVIO` ou `NAO_APROVADO`.

---

## API workflow (além do RMA base)

| Método | Path |
|--------|------|
| PUT | `/rma/checklists` |
| POST | `/rma/checklists/clonar` |
| POST | `/rma/:id/itens/:itemId/checklist/:tipo/iniciar` |
| PUT/POST | `…/checklist/:tipo` · `…/concluir` |
| PUT/POST | `…/diagnostico-plano` · `…/concluir` |
| GET | `…/orcamento/sugestao` |
| PUT/POST | `…/orcamento` · `…/enviar` · `…/aprovar` · `…/recusar` |

Laudo PDF (`RmaAnexo`) continua como evidência complementar; o gate de avanço é o checklist + plano.
