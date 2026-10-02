/** Campos do tipo usados para amarrar estoque no lançamento manual. */
export type TipoFiliaisSource = {
  sistema: boolean;
  rmaEntradaEstoque: boolean;
  rmaSaidaCliente: boolean;
  saidaPedidoVenda: boolean;
  operacao: string;
  filialId: string | null;
  filialDestinoId: string | null;
};

/**
 * Lançamento operacional (não sistema/RMA/pedido): filiais vêm do tipo.
 * Ignora filialId/filialDestinoId do body.
 */
export function aplicarFiliaisDoTipoOperacional(
  tipo: TipoFiliaisSource,
  input: { filialId?: string; filialDestinoId?: string | null },
  usoInterno: boolean
): { ok: true } | { ok: false; message: string } {
  const tipoRma =
    tipo.rmaEntradaEstoque === true || tipo.rmaSaidaCliente === true;
  const tipoPedido = tipo.saidaPedidoVenda === true;
  const tipoOperacional =
    !tipo.sistema && !tipoRma && !tipoPedido && !usoInterno;
  if (!tipoOperacional) return { ok: true };

  if (!tipo.filialId) {
    if (!input.filialId) {
      return {
        ok: false,
        message: "Selecione o estoque do lançamento",
      };
    }
    if (tipo.operacao === "TRANSFERENCIA" && !tipo.filialDestinoId) {
      if (!input.filialDestinoId) {
        return {
          ok: false,
          message: "Selecione o estoque de destino",
        };
      }
    }
    return { ok: true };
  }
  if (tipo.operacao === "TRANSFERENCIA" && !tipo.filialDestinoId) {
    if (!input.filialDestinoId) {
      return {
        ok: false,
        message: "Selecione o estoque de destino",
      };
    }
    input.filialId = tipo.filialId;
    return { ok: true };
  }
  input.filialId = tipo.filialId;
  input.filialDestinoId =
    tipo.operacao === "TRANSFERENCIA" ? tipo.filialDestinoId : null;
  return { ok: true };
}
