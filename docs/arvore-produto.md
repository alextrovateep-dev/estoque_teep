# Árvore de produto e baixa pela árvore

**Status:** implementado.  
**Tela:** Cadastros → **Árvore de produto** (`/cadastros/arvore`).

---

## Ideia

A árvore (BOM) define quais componentes formam um produto acabado (**1 nível**, sem explosão recursiva).  
A **baixa pela árvore** ocorre quando esse produto **sai** (SAÍDA ou TRANSFERÊNCIA com flag no tipo) — **nunca** na entrada.

---

## Cadastro (UI)

- Permissões: `cadastros_arvore_ver` / `cadastros_arvore_editar` (API de gravação: Admin ou Gerente + `cadastros_arvore_editar`).
- Listar produtos com árvore; editar pai + linhas (filho, qtd, **Fantasma**); salvar via `PUT /produtos/:id/componentes`.
- Também dá para enviar `componentes` no `PATCH /produtos/:id` (API); a UI dedicada é a página Árvore.
- **Simulação:** quantidade do pai + estoque → necessário / disponível (saldo − reserva de transferência) / falta / valores. Usa a árvore **já salva** (salve o rascunho antes).
- Export da simulação: PDF e XLSX.

Na BOM: componente **não-fantasma** com `controlaSerie` é **recusado** no cadastro (MVP sem série na baixa).

---

## Tipo de movimentação

Flag `baixaPorArvore` só em **SAIDA** ou **TRANSFERENCIA**.  
Tipo com árvore **não pode** ter `requerAprovacao` (bloqueado no cadastro do tipo e na movimentação).

Tipo de sistema (seed): **Baixa de componente (árvore)** (`TIPO_CONSUMO_MONTAGEM`) — movimentos internos de consumo dos filhos.

---

## Regras de baixa (lançamento)

1. Tipo com `baixaPorArvore` + produto com BOM válida.
2. Componentes **não fantasma** saem da **origem** (`qtd lançada × qtd na árvore`).
3. **Fantasma** = só estrutura; não movimenta saldo.
4. Precisa de ao menos **um** não-fantasma (só fantasmas = nada a baixar / erro conforme fluxo).
5. Filho com série (não-fantasma) → erro no lançamento.

| Operação | Documento | Estoque |
|----------|-----------|---------|
| **Saída** | Saída do produto pai | Baixa só componentes; **não** debita saldo do pai |
| **Transferência** | Carga / destino | Origem: baixa componentes · Destino: entra o **pai** (item único) |

No Novo Lançamento, baixa por árvore **desliga** o modo multi-SKU (uma linha / fluxo especial).

---

## API

| Método | Path |
|--------|------|
| `GET` | `/produtos/arvores` |
| `GET` | `/produtos/:id/componentes` |
| `PUT` | `/produtos/:id/componentes` |
| `GET` | `/produtos/:id/arvore/simulacao?quantidade=&filialId=` |
| `GET` | `/produtos/:id/arvore/simulacao/export.pdf` · `export.xlsx` |

Serviços: `montagemService.ts`, `simulacaoArvoreService.ts`, `arvoreExportService.ts`.  
Smoke: `apps/api/scripts/smoke-montagem.ts`.

---

## Relacionado

- Lançamento / exceção multi-SKU: [lancamento.md](./lancamento.md)
- Relatórios (export de árvores, se usado na tela Relatórios): ver UI `/relatorios`
