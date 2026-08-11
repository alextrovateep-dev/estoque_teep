# Geração e controle de número de série

**Status:** implementado.  
**Impressão de etiquetas:** [backlog-impressao-zebra.md](./backlog-impressao-zebra.md) (backlog).

---

## O que existe hoje

| Peça | Onde |
|------|------|
| Flag `controlaSerie` + `ConfiguracaoSerie` | Cadastro do produto |
| Gerar lote (reserva contador) | Novo Lançamento · ENTRADA · `POST /series/alocar` |
| Desfazer lote pendente | `POST /series/alocar/desfazer` |
| Confirmar no estoque | `POST /movimentacoes` com as séries → cria `UnidadeSerie` |
| Digitar série manual | Mesmo lançamento (sem alocar), se `geracaoAutomatica=false` ou escolha do usuário |
| Consulta / filtro | Dashboard e **Movimentações** (`?serie=`). `/estoque/series` só redireciona |
| Saída / transferência | Séries validadas (`/series/validar-saida`); checklist na conferência |

**Não faz:** import CSV, flag `geraNumeroSerie` em tipo de movimentação, impressão Zebra no app, criar `UnidadeSerie` na alocação (só no lançamento).

---

## Configuração no produto

Modelo `ConfiguracaoSerie` (defaults no código / shared):

| Campo | Padrão | Notas |
|-------|--------|--------|
| `formato` | `{codigo}{ano2}{seq4}` | Presets compacto / com hífens; tokens `{codigo}` `{ano2}` `{seqN}` |
| `geracaoAutomatica` | `true` | Se `false`, alocar recusa — usuário digita |
| `tamanhoSequencial` | `4` | Entre 3 e 6 |
| `prefixoFixo` / `sufixoFixo` | null | Opcionais |
| `reiniciarAnual` | `true` | Contador por ano; se `false`, ano lógico `0` |

Exemplos: `TMP4426250001` · `TMP4426-25-0001`.  
Lógica: `packages/shared/src/serieFormat.ts` + `geracaoSerieService.ts`. Máx. **500** séries por lote.

---

## Fluxo de geração (entrada)

```text
Produto controlaSerie + geracaoAutomatica
  → UI: informar quantidade → POST /series/alocar
  → SerieAlocacao PENDENTE + ContadorSerie avançado (FOR UPDATE)
  → campos preenchidos com as séries
  → POST /movimentacoes (todas as séries do lote)
  → UnidadeSerie EM_ESTOQUE + alocação CONFIRMADA

Desistir antes do lançamento:
  → POST /series/alocar/desfazer { alocacaoId }
  → reverte contador se ainda for o topo e não houver UnidadeSerie
```

Lote gerado é atômico no lançamento: ou entram todas, ou desfaz (parcial rejeitado).

Entrada manual: usuário preenche N séries; API valida unicidade/formato no movimento.

---

## API útil

| Método | Path |
|--------|------|
| `POST` | `/series/alocar` `{ produtoId, quantidade }` |
| `POST` | `/series/alocar/desfazer` `{ alocacaoId }` |
| `GET` | `/series/contador/:produtoId` |
| `POST` | `/series/validar-saida` |
| `GET` | `/series?q=` |

Smoke: `apps/api/scripts/smoke-geracao-serie.ts`.

---

## Fora / relacionado

- Init com séries: `/estoque/init`
- RMA troca de série: [rma.md](./rma.md)
- Multi-SKU no lançamento: [lancamento.md](./lancamento.md)
