# Orientação — RMA (Fase 2)

Documento de planejamento. **Processo RMA completo (laudo/cobrança) ainda não implementado.**  
**Rastreio por número de série** já existe no núcleo de estoque (produtos com `controlaSerie`).

## Contexto

Solicitação do financeiro: controlar entrada e saída de RMA com laudo técnico, cobrança e notas fiscais, tratando **itens de forma individual** (mesmo que a entrada inicial traga vários SKUs).

## Requisitos levantados

1. **Anexo do laudo técnico** (Larissa) por item em processo.
2. **Cobrança Sim/Não** por item; se Sim: valor cobrado + número da NF de cobrança.
3. **NF de entrada e NF de saída** do RMA no histórico (financeiro).
4. **Status do item**: em análise / interno / descartado / devolvido ao cliente / enviado a fornecedor, etc.
5. **Cliente dono** do item rastreável do início ao fim.
6. Entrada pode agrupar vários itens; o processo RMA é **por unidade/linha**.

## Por que não cabe só em “Novo Lançamento”

- Um único anexo NF por movimentação não cobre laudo + orçamento por item.
- Ciclo de vida longo (entrada → laudo → cobrança → saída/descarte) precisa de tela de gestão.
- Séries já são obrigatórias nos lançamentos/retornos quando o produto tem `controlaSerie`; o que falta é o **workflow** RMA (status, laudo, cobrança).

## Direção sugerida (fase 2)

### Modelo

- `RmaProcesso` (cabeçalho: cliente, NF entrada, datas, responsável).
- `RmaItem` (produto, vínculo com `UnidadeSerie` quando aplicável, status, laudo arquivo, cobrou?, valor, NF cobrança, NF saída, vínculos de movimentação de estoque).

### Fluxos

1. Abrir processo RMA (entrada no estoque “quarentena” ou filial) — reutilizar séries do lançamento de entrada/retorno.
2. Registrar laudo/orçamento por item.
3. Decidir: cobrar / devolver / descartar / enviar a fornecedor.
4. Gerar/vincular movimentações de estoque e NFs.

### UI

- Lista de processos RMA + detalhe por item.
- Filtros: cliente, status, cobrado, período.
- Integração com upload tipado (`MovimentacaoAnexo` / anexos do item).
- Consulta de série (`/estoque/series`) já disponível para rastreio operacional.

### Fora de escopo imediato

- Integração fiscal automática (só registro dos números).

## Relação com o estoque atual

Reaproveitar: `UnidadeSerie` / `MovimentacaoSerie`, `MovimentacaoAnexo`, tipos com `requerCliente` / `ehRetornoDe`, e-mail/notificações, histórico por cliente.  
Não reutilizar o vínculo demo/comodato como substituto do RMA — domínio diferente.

## Próximo passo

Workshop com financeiro + operações para fechar status do item; depois backlog de implementação do processo RMA (laudo/cobrança) em cima do rastreio de série já entregue.
