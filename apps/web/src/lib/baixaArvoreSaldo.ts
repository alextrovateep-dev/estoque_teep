export type BomLinhaBaixa = {
  produtoFilhoId: string;
  quantidade: number;
  fantasma: boolean;
  produtoFilho: { codigo: string; descricao?: string; unidade?: string };
};

export type ConsumoArvoreOrigem = {
  produtoFilhoId: string;
  codigo: string;
  unidade?: string;
  quantidade: number;
};

/** Componentes que a baixa pela árvore debita na origem (não-fantasma). */
export function consumoBaixaArvoreOrigem(
  bom: BomLinhaBaixa[],
  quantidadePai: number
): ConsumoArvoreOrigem[] {
  const qtd = Number(quantidadePai);
  const montada = Number.isFinite(qtd) && qtd > 0 ? qtd : 0;
  return bom
    .filter((b) => !b.fantasma)
    .map((b) => ({
      produtoFilhoId: b.produtoFilhoId,
      codigo: b.produtoFilho.codigo,
      unidade: b.produtoFilho.unidade,
      quantidade: b.quantidade * montada,
    }));
}

export function consumoArvoreComFalta(
  consumo: ConsumoArvoreOrigem[],
  saldosOrigem: Record<string, number | null | undefined>
): ConsumoArvoreOrigem[] {
  return consumo.filter((c) => {
    const saldo = saldosOrigem[c.produtoFilhoId];
    return (
      saldo != null &&
      Number.isFinite(saldo) &&
      c.quantidade > saldo + 1e-9
    );
  });
}
