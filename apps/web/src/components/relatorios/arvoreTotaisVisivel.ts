export type ArvoreComponenteRelatorio = {
  produtoFilhoId?: string;
  codigo: string;
  descricao: string;
  quantidade: number;
  fantasma: boolean;
  temBom?: boolean;
  precoUnitario: number;
  valorLinha: number;
};

/**
 * Totais da árvore visível: kit aberto conta os filhos (qtd × fator do pai),
 * não a linha do kit. Valor da composição continua só no 1º nível.
 */
export function totaisArvoreVisivel(
  componentes: ArvoreComponenteRelatorio[],
  abertas: Set<string>,
  filhos: Record<string, ArvoreComponenteRelatorio[]>,
  fatorPai = 1
): { itens: number; quantidade: number } {
  let itens = 0;
  let quantidade = 0;
  for (const c of componentes) {
    const id = c.produtoFilhoId;
    const qtdEfetiva = Number(c.quantidade || 0) * fatorPai;
    const kids = id && abertas.has(id) ? filhos[id] : undefined;
    if (kids && kids.length > 0) {
      const sub = totaisArvoreVisivel(kids, abertas, filhos, qtdEfetiva);
      itens += sub.itens;
      quantidade += sub.quantidade;
    } else {
      itens += 1;
      quantidade += qtdEfetiva;
    }
  }
  return { itens, quantidade };
}
