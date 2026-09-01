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
