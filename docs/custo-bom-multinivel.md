# Explosão de custo BOM multinível

## Contexto

O sistema de produção da TEEP opera em dois níveis:

1. **KIT (semi-acabado)** — itens comprados entram no Estoque Central, são montados em KIT com BOM própria e entram no Estoque Produção como produto.
2. **Produto Final** — BOM inclui o KIT + outros itens. Na montagem, o KIT é baixado do Estoque Produção.

O movimento de estoque é **corretamente 1-nível** — o `montagemService` não foi alterado. O problema era que o **cálculo de custo** usava o `precoUnitario` do cadastro do filho, que é o preço de venda/referência, não o custo real de fabricação. Quando um filho tem BOM própria (ex: KIT), seu custo real é a soma dos seus componentes, não o `precoUnitario`.

## O que foi implementado

Explosão recursiva de custo BOM para três pontos do sistema:

| Ponto | Antes | Depois |
|-------|-------|--------|
| Tela Árvore (`/cadastros/arvore`) | `precoUnitario` do filho | custo explodido via BOM |
| Simulação de produção (`/arvore/simulacao`) | `precoUnitario` do filho | custo explodido via BOM |
| Export PDF/Excel da árvore | `precoUnitario` do filho | custo explodido via BOM |

**O que não mudou:** `montagemService.ts`, schema do banco, migrations, `PUT /produtos/:id/componentes`, qualquer outra rota.

---

## Arquivos alterados

### Novo — `apps/api/src/services/bomCustoService.ts`

Serviço utilitário com função única `calcularCustoBom(produtoId, tx, visitados?)`.

**Regras:**
- Se o produto não tem BOM → retorna `null` (caller usa `precoUnitario` como fallback)
- Se tem BOM mas todos os itens são fantasma → retorna `null` (fallback)
- Se tem BOM com itens reais → retorna `soma(qtd × custo_filho)` recursivamente
- Itens fantasma não entram no custo
- Proteção contra ciclos via `Set<string> visitados` (DFS com backtracking — não bloqueia diamantes, só ciclos reais)
- Recebe `Prisma.TransactionClient` — sempre roda dentro de transação do caller

### Alterado — `apps/api/src/routes/cadastros.ts`

`GET /produtos/:id/componentes` — mudança aditiva, sem breaking change.

Cada item da resposta ganhou dois campos novos:

```ts
temBom: boolean        // true quando o filho tem BOM própria
custoExplodido: number // custo real explodido; igual a precoUnitario quando temBom=false
```

O handler agora roda dentro de `prisma.$transaction` e processa os itens sequencialmente (loop `for...of`, não `Promise.all`) para evitar concorrência na mesma conexão de transação.

### Alterado — `apps/api/src/services/simulacaoArvoreService.ts`

`calcularSimulacaoArvore` — o loop de cálculo foi envolvido em `prisma.$transaction`.

```ts
// antes
const preco = Number(b.produtoFilho.precoUnitario);

// depois
const custoBom = await calcularCustoBom(b.produtoFilhoId, tx);
const preco = custoBom !== null ? custoBom : Number(b.produtoFilho.precoUnitario);
```

`qtyReservadaTransferenciaPendente` passou de `prisma` para `tx` — compatível, a função já aceita `Prisma.TransactionClient | PrismaClient`.

### Alterado — `apps/api/src/services/arvoreExportService.ts`

`carregarArvoreExport` — o `pais.map(...)` síncrono foi substituído por `Promise.all` com uma transação por pai. Dentro de cada transação, os componentes são processados sequencialmente.

`id` foi adicionado ao `select` do `produtoFilho` (necessário para passar ao `calcularCustoBom`).

### Alterado — `apps/web/src/app/cadastros/arvore/page.tsx`

- Tipo `BomItem` ganhou `custoExplodido?: number` e `temBom?: boolean`
- `abrirArvore` mapeia os novos campos da resposta da API
- `useMemo custos` usa `b.custoExplodido ?? b.precoUnitario` em vez de `b.precoUnitario` direto
- Coluna "Preço" exibe badge `via BOM` em teal quando `temBom = true`
- Itens adicionados via busca (sem `custoExplodido`) fazem fallback para `precoUnitario`

---

## Comportamento do fallback

Em todos os pontos, a lógica de fallback é a mesma:

```
custoBom = calcularCustoBom(filhoId, tx)
preco = custoBom !== null ? custoBom : precoUnitario
```

Casos que retornam `null` (usa `precoUnitario`):
- Produto sem BOM (item comprado puro)
- BOM existe mas todos os itens são fantasma
- Ciclo detectado no grafo de BOM

---

## Commit

```
feat(arvore): explosão de custo BOM multinível
```

Arquivos do commit:
- `apps/api/src/services/bomCustoService.ts` (novo)
- `apps/api/src/services/simulacaoArvoreService.ts`
- `apps/api/src/services/arvoreExportService.ts`
- `apps/api/src/routes/cadastros.ts`
- `apps/web/src/app/cadastros/arvore/page.tsx`
