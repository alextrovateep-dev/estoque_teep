# Transformação de produto (A → B)

**Status:** implementado.  
**Tela:** Operações → **Transformação** (`/lancamentos/transformacao`).  
**Permissão:** `lancamentos`.

---

## Ideia

Um acabado **A** já está no estoque com número de série. Ele é transformado em outro produto **B** da linha:

1. A sai do estoque; a série de A fica **SAIDO** (morre).
2. Componentes baixados = **diff** das árvores 1 nível: o que B precisa **além** do que A já carrega (`max(0, qtyB − qtyA)` por filho).
3. B entra no estoque; nasce **série nova** de B.
4. O vínculo A↔B fica em `produto_transformacoes` (histórico obrigatório).

Exemplo: TMP-1144-W (árvore: `KIT-MP-ESP32-W`) → TMP-1144-WE (árvore: `KIT-MP-ESP32-W` + `MP-REDE-W5500`) → baixa só `MP-REDE-W5500`.

Não reaproveita a montagem por transferência: aquela nasce o pai sem consumir série de acabado.

---

## Regras

- Origem e destino ativos, **diferentes**, ambos com `controlaSerie`.
- Série de A deve estar `EM_ESTOQUE` na filial escolhida (não em trânsito).
- B precisa ter BOM cadastrada.
- Diff 1 nível, não-fantasma. Fantasma em A **não cobre** necessidade de B.
- Se o próprio A aparecer como filho na BOM de B, essa linha é excluída (A já está saindo como acabado).
- Se a BOM de A estiver vazia, o preview **avisa** e a baixa usa a árvore inteira de B (nada coberto).
- Componentes só em A (e não em B) saem com A e **não voltam** ao estoque.
- Filho com série na BOM de B (não-fantasma) continua **bloqueado** no delta (igual montagem).
- Série de B: informada ou **alocada** automaticamente (`/series/alocar`).
- **Sem estorno automático** no MVP.

---

## Filiais

Operação **atômica** na filial escolhida (ex.: Produção). Se o fluxo físico for acabado → produção → acabado, use **Transferências** antes/depois; a transformação em si não cria carga.

---

## API

| Método | Path |
|--------|------|
| `GET` | `/transformacoes` — lista (filialId, q, page) |
| `GET` | `/transformacoes/preview?filialId=&produtoOrigemId=&produtoDestinoId=` — diff + saldos + avisos |
| `POST` | `/transformacoes` — body: filialId, produtoOrigemId, numeroSerieOrigem, produtoDestinoId, numeroSerieDestino?, observacao? |
| `GET` | `/series/:id/historico` — inclui `transformacoes` (originadoDe / transformadoEm) |

Tipos de sistema (seed / boot):

- `Transformação — saída origem`
- `Transformação — entrada destino`
- Consumos: `Baixa de componente (árvore)`

---

## Serviços

- `apps/api/src/services/transformacaoService.ts` (`diffBomTransformacao`, `previewTransformacao`, `criarTransformacao`)
- Reuso: `montagemService`, `serieService`, `geracaoSerieService`

---

## Fora do MVP

- Estorno da transformação
- TeepAI
- Manter o mesmo N/S mudando só o código do produto
- Explosão multinível na baixa
- Seleção manual de quais linhas baixar (override do diff)
