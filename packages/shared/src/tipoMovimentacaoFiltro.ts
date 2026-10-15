/** Explode BOM só se a flag do tipo estiver ligada — nunca por ser SAIDA. */
export function tipoUsaBaixaArvore(opts: {
  baixaPorArvore?: boolean | null;
  saidaPedidoVenda?: boolean | null;
  usoInternoPedido?: boolean;
}): boolean {
  return (
    opts.baixaPorArvore === true &&
    opts.saidaPedidoVenda !== true &&
    !opts.usoInternoPedido
  );
}

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

export type EscopoRetornoCliente = "demo" | "comodato";

/** Demonstração vs comodato a partir do nome/código do tipo. */
export function escopoRetornoClienteDeTipo(t: {
  nome?: string | null;
  codigo?: string | null;
}): EscopoRetornoCliente | null {
  const blob = `${t.nome || ""} ${t.codigo || ""}`;
  const demo = /demonstr/i.test(blob);
  const comodato = /comodato/i.test(blob);
  if (demo && !comodato) return "demo";
  if (comodato && !demo) return "comodato";
  return null;
}

/**
 * Entrada de retorno de demonstração/comodato no Novo Lançamento.
 * Usa o vínculo cadastrado (ehRetornoDeId) ou nome com “retorno” +
 * demonstração/comodato (tipo em produção ainda sem o vínculo).
 * Não inclui entrada de RMA, compra nem “retorno” genérico.
 */
export function tipoEntradaEhRetornoCliente(t: {
  operacao?: string | null;
  ehRetornoDeId?: string | null;
  rmaEntradaEstoque?: boolean | null;
  nome?: string | null;
  codigo?: string | null;
}): boolean {
  if (t.operacao !== "ENTRADA") return false;
  if (t.rmaEntradaEstoque === true) return false;
  if (t.ehRetornoDeId) return true;
  const blob = `${t.nome || ""} ${t.codigo || ""}`;
  if (!/\bretorno\b/i.test(blob)) return false;
  return /demonstr|comodato/i.test(blob);
}

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
