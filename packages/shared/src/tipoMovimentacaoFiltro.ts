export type TipoParaFiltroMovimentacoes = {
  sistema?: boolean | null;
  rmaEntradaEstoque?: boolean | null;
  rmaSaidaCliente?: boolean | null;
  saidaPedidoVenda?: boolean | null;
};

/** Tipos exibidos no dropdown de filtro da tela Movimentações. */
export function tipoVisivelFiltroMovimentacoes(
  t: TipoParaFiltroMovimentacoes
): boolean {
  if (t.sistema === true) return false;
  if (t.rmaEntradaEstoque === true || t.rmaSaidaCliente === true) return false;
  if (t.saidaPedidoVenda === true) return false;
  return true;
}

export type TipoParaLancamento = {
  sistema?: boolean | null;
  permitidoOperador?: boolean | null;
  permitidoGerente?: boolean | null;
  filialId?: string | null;
};

/**
 * Novo Lançamento: todo tipo de negócio ativo que o perfil pode usar.
 * Tipos sistema ficam de fora. RMA / pedido / sem estoque fixo aparecem
 * (o estoque pode ser escolhido na tela se o cadastro não tiver).
 */
export function tipoVisivelLancamento(
  t: TipoParaLancamento,
  opts: { perfil: string; operadorFilialIds?: string[] }
): boolean {
  if (t.sistema === true) return false;
  const permitido =
    opts.perfil === "OPERADOR"
      ? t.permitidoOperador === true
      : opts.perfil === "GERENTE" || opts.perfil === "ADMIN"
        ? t.permitidoGerente === true
        : false;
  if (!permitido) return false;
  if (opts.perfil === "OPERADOR" && t.filialId) {
    const ids = opts.operadorFilialIds || [];
    if (!ids.includes(t.filialId)) return false;
  }
  return true;
}
