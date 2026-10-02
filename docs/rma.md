# RMA — processo e estoque

**Status:** ampliado (checklist por produto, diagnóstico com tempo, orçamento agregado do processo, liberação).  
**Telas:** `/rma` (abas Em aberto / Cancelados / Liberados-Enviado; processo só em envio/finalizado sai de Em aberto) · `/rma/novo` · `/rma/[id]` · `/rma/[id]/orcamento` · `/cadastros/rma-checklists`  
**Permissões:** `rma` · `rma_cobranca`

---

## Princípios

1. **Estoque = motor padrão** — transferência/lançamento entre filiais (`Filial`).
2. **Processo = nota** — cliente, NFs, estoque RMA, destinatários, comercial.
3. **Item = manutenção** — checklist, diagnóstico/plano+peças (com tempo nos serviços), liberação, devolução/troca.
4. **Laudo no sistema** — diagnóstico + checklist; anexo arquivo `LAUDO` não é mais aceito para novos uploads.
5. **Orçamento do processo** — formulário/PDF em `/rma/[id]/orcamento` (agrega itens); **PDF interno** = orçamento + laudo de recebimento (detalhado); **PDF comercial** = só valor total para o cliente (inclui item já aprovado, ex. sem cobrança); **Documentos** no detalhe do RMA guarda laudos de entrada/saída, orçamento arquivo e quem autorizou a troca (também com RMA fechado); persistência continua 1 `RmaOrcamento` por item; aprovação por item.
6. **Checklist por produto (SKU)** — templates RECEBIMENTO e LIBERACAO.
7. **Tipos de movimentação por flag** — Admin → Tipos: `rmaEntradaEstoque` e `rmaSaidaCliente`.
8. **Frete na liberação/envio** — modalidade (transportadora / retiro próprio / entrega TEEP) + cobrado Sim/Não; bloqueia devolver/trocar sem esses dados.
9. **Troca antecipada** — exige o colaborador que autorizou.
10. **Aprovar sem cobrança** — comercial/gerente/admin aprova o laudo e o item segue (não é recusa). Ticket aberto por engano: **Excluir abertura** só Admin (estorna estoque; fica em Cancelados). Gerente cancela.

---

## Etapas do item

`AGUARDANDO_RECEBIMENTO` (**Aguardando inspeção / diagnóstico** — o estoque RMA já entra na abertura) → checklist de inspeção (se o produto tiver template) + diagnóstico/plano/peças → **Concluir diagnóstico** → `AGUARDANDO_ORCAMENTO` → (página Orçamento: valores + **Fechar orçamento** + **Gerar PDF** + orçar com o cliente) → `AGUARDANDO_APROVACAO` → aprovar por item → `AGUARDANDO_MANUTENCAO` → manutenção realizada → `AGUARDANDO_LIBERACAO` → checklist liberação → `AGUARDANDO_ENVIO` → Devolver/Trocar (**retorno**) → `FINALIZADO`

**Fechar orçamento não finaliza o RMA e não trava valores.** Abre a etapa para o comercial gerar PDF, negociar, alterar valores e gerar um PDF novo. O processo só vai a `FECHADO` quando todos os itens tiverem retorno (ou cancelamento).

Recusa do orçamento → `NAO_APROVADO`. Reabrir (só enquanto fechado, ainda não aprovado/recusado) → volta a `AGUARDANDO_ORCAMENTO` / rascunho.

`AGUARDANDO_LAUDO` é legado (migrado para `AGUARDANDO_RECEBIMENTO`).

---

## Papéis no orçamento

| Quem | Onde | Faz |
|------|------|-----|
| Técnico | Modal do item | Checklist; serviços com **tempo (minutos)**; Salvar / Concluir diagnóstico |
| Comercial | `/rma/[id]/orcamento` | Preenche **valor** dos serviços; Salvar; **Fechar orçamento** (status `ENVIADO` + e-mail/sino à equipe; libera PDF/negociação; valores continuam editáveis); **Gerar PDF** (orçamento + laudo de recebimento); envia PDF ao cliente por e-mail/WhatsApp; ajusta e gera PDF de novo; **Aprovar/Recusar** (também avisa a equipe). **Reabrir** volta ao rascunho. |

`RmaOrcamento.status` no banco continua `RASCUNHO | ENVIADO | APROVADO | RECUSADO`. Na tela, `ENVIADO` aparece como **Em negociação**.

`RmaOrcamento.maoDeObra` permanece no schema (compat) e fica **0**; valores nas linhas `SERVICO`.

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
| PUT/POST | `…/orcamento` · `…/enviar` · `…/fechar` · `…/reabrir` · `…/aprovar` · `…/recusar` |
| GET | `/rma/:id/orcamento` |
| PUT | `/rma/:id/orcamento` (lote) |
| POST | `/rma/:id/orcamento/enviar` `{ itemIds }` (alias: `/fechar`) — fecha rascunhos; status interno `ENVIADO`; dispara alerta `RMA_ORCAMENTO` |
| POST | `/rma/:id/itens/:itemId/orcamento/reabrir` — só `ENVIADO` + `AGUARDANDO_APROVACAO`; volta a rascunho |
| GET | `/rma/:id/orcamento.pdf` — orçamento interno (detalhado + laudo de recebimento) |
| GET | `/rma/:id/orcamento/comercial.pdf` — orçamento comercial (só total) |
| GET | `/rma/:id/orcamento/arquivo.pdf` — orçamento histórico (aprovado/recusado; RMA fechado) |
| GET | `/rma/:id/itens/:itemId/laudo/RECEBIMENTO/pdf` · `…/LIBERACAO/pdf` — laudos de entrada/saída |
| PATCH | `/rma/:id/frete` — modalidade + cobrado |
| POST | `/rma/:id/sem-cobranca` — aprova sem fatura (`cobrou=false`, observação obrigatória) |
| POST | `/rma/:id/excluir-abertura` — só Admin; estorna como cancelar |
| GET | `/rma?aba=aberto\|cancelado\|enviado` — lista por aba |

Gate de avanço: plano/diagnóstico; checklist de inspeção só se o produto tiver template (não anexo de laudo).
