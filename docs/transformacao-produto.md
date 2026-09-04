# Transformação de produto (A → B)

**Status:** implementado (MVP).  
**Tela:** Operações → **Transformação** (`/lancamentos/transformacao`).  
**Permissão:** `lancamentos`.

---

## Ideia

Um acabado **A** já está no estoque com número de série. Ele é transformado em outro produto **B** da linha:

1. A sai do estoque; a série de A fica **SAIDO** (morre).
2. Componentes da **árvore de B** (1 nível, não-fantasma) são baixados no mesmo estoque — **exceto** o próprio A, se A estiver na BOM de B.
3. B entra no estoque; nasce **série nova** de B.
4. O vínculo A↔B fica em `produto_transformacoes` (histórico obrigatório).

Não reaproveita a montagem por transferência: aquela nasce o pai sem consumir série de acabado.

---

## Regras

- Origem e destino ativos, **diferentes**, ambos com `controlaSerie`.
- Série de A deve estar `EM_ESTOQUE` na filial escolhida (não em trânsito).
- B precisa ter BOM cadastrada.
- Filho com série na BOM de B (não-fantasma) continua **bloqueado** (igual montagem).
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
| `GET` | `/transformacoes/preview?filialId=&produtoDestinoId=&produtoOrigemId=` |
| `POST` | `/transformacoes` — body: filialId, produtoOrigemId, numeroSerieOrigem, produtoDestinoId, numeroSerieDestino?, observacao? |
| `GET` | `/series/:id/historico` — inclui `transformacoes` (originadoDe / transformadoEm) |

Tipos de sistema (seed / boot):

- `Transformação — saída origem`
- `Transformação — entrada destino`
- Consumos: `Baixa de componente (árvore)`

---

## Serviços

- `apps/api/src/services/transformacaoService.ts`
- Reuso: `montagemService`, `serieService`, `geracaoSerieService`

---

## Fora do MVP

- Estorno da transformação
- TeepAI
- Manter o mesmo N/S mudando só o código do produto
- Explosão multinível na baixa
