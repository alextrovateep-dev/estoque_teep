# RMA — processo e estoque

**Status:** implementado (abertura com destinatários e comercial; **etapas, aprovação e cobrança por item**; laudos; devolução; troca; cancelamento).  
**Telas:** `/rma` · `/rma/novo` · `/rma/[id]`  
**Permissões:** `rma` · `rma_cobranca` (cobrança por item + NFs do processo)

---

## Princípios

1. **Estoque = motor padrão** — transferência/lançamento entre filiais (`Filial`). Sem “descarte paralelo”.
2. **Processo = nota** — cliente, NFs entrada/saída, estoque RMA, destinatários, comercial, status `ABERTO/FECHADO/CANCELADO`.
3. **Item = manutenção** — laudo, etapa, aprovação comercial, cobrança, manutenção realizada, devolução/troca. No mesmo RMA um item pode ser aprovado e outro não.
4. **Corrigir ≠ cancelar** — cliente errado → alterar cliente; série errada → remover item e incluir o certo. Cancelar é emergência (Gerente/Admin).
5. **Notificações por processo** — lista de destinatários (padrão = tick `RMA_ABERTO`).
6. **Estoques configuráveis** — `RMA`, `DESC`, operacionais etc.

---

## Status e etapas

| Entidade | Valores |
|----------|---------|
| **Processo** | `ABERTO` · `FECHADO` · `CANCELADO` |
| **Item (estoque)** | `EM_ESTOQUE` · `SEM_MANUTENCAO` · `DEVOLVIDO` · `DESCARTADO` · `CANCELADO` |
| **Item (etapa)** | `AGUARDANDO_LAUDO` → `AGUARDANDO_APROVACAO` → `AGUARDANDO_MANUTENCAO` \| `NAO_APROVADO` → `AGUARDANDO_ENVIO` → `FINALIZADO` |

Devolver/Trocar só com etapa `AGUARDANDO_ENVIO` ou `NAO_APROVADO`. Fechamento automático quando não restam itens em `ABERTO` / `EM_ESTOQUE` / `SEM_MANUTENCAO`.

---

## Fluxo por item

```text
Abrir RMA (nota) → itens EM_ESTOQUE + AGUARDANDO_LAUDO + RMA_ABERTO
        │
        ▼
 Anexar laudo(s) → Notificar laudos → AGUARDANDO_APROVACAO + RMA_LAUDO
        │
        ├── APROVADA  → AGUARDANDO_MANUTENCAO → (Manutenção realizada) → AGUARDANDO_ENVIO → Devolver / Trocar
        └── RECUSADA  → NAO_APROVADO (+ SEM_MANUTENCAO) → Devolver / Trocar (sem manutenção)
```

Cobrança (`cobrou` / valor / NF cobrança) é **por item** (`PATCH /rma/:id/itens/:itemId/financeiro`). Editável com permissão `rma_cobranca` enquanto o processo estiver `ABERTO` ou `FECHADO` (não em `CANCELADO`), inclusive após a etapa `FINALIZADO`.

Anexos de NF do processo:
- **NF entrada** e **NF retorno** (`NF_SAIDA`): incluir **antes de fechar**; depois só visualização.
- **NF cobrança** (`NF_COBRANCA`): financeiro (`rma_cobranca`) pode anexar/trocar **também após `FECHADO`**.

Notificar laudos: só com processo `ABERTO` (desativado para todos se `FECHADO`/`CANCELADO`).

API item: `POST /rma/:id/itens/:itemId/aprovacao` · `POST /rma/:id/itens/:itemId/manutencao-realizada` · `PATCH /rma/:id/itens/:itemId/financeiro`.

Aprovação **não** existe no processo — só na etapa do item.

---

## Responsável comercial

- Cadastro do Cliente: comercial opcional; na abertura do RMA é **obrigatório**.
- Quem decide por item: comercial do processo ou Admin/Gerente.
- Enquanto houver itens em laudo/aprovação, dá para alterar o comercial.

---

## Destinatários e alertas

| Momento | Canal |
|---------|--------|
| Criar RMA | `RMA_ABERTO` |
| Notificar laudos | `RMA_LAUDO` (+ avança etapa dos itens com laudo) |
| Cobrança do item / encerrar | `RMA_FINANCEIRO` · `RMA_ENCERRADO` |

---

## O que o sistema faz hoje

| Ação | Efeito |
|------|--------|
| Abrir processo | Entrada RMA + comercial + destinatários |
| Notificar laudos | E-mail/sino; itens com laudo → aguardando aprovação |
| Aprovar / recusar (item) | Etapa manutenção ou não aprovado |
| Manutenção realizada | Libera envio |
| Cobrança (item) | Valor/NF por item |
| Devolver / Trocar | Só se etapa liberada; item → FINALIZADO |
| Cancelar | Só Gerente/Admin |

Alertas: ver [alertas-email](./alertas-email.md).
