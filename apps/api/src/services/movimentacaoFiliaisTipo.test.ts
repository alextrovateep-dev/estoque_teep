import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aplicarFiliaisDoTipoOperacional } from "./movimentacaoFiliaisTipo";

const FILIAL_TIPO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILIAL_DEST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FILIAL_ERRADA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("aplicarFiliaisDoTipoOperacional", () => {
  it("sobrescreve filial do body pela do tipo (ENTRADA)", () => {
    const input: { filialId?: string; filialDestinoId?: string | null } = {
      filialId: FILIAL_ERRADA,
    };
    const r = aplicarFiliaisDoTipoOperacional(
      {
        sistema: false,
        rmaEntradaEstoque: false,
        rmaSaidaCliente: false,
        saidaPedidoVenda: false,
        operacao: "ENTRADA",
        filialId: FILIAL_TIPO,
        filialDestinoId: null,
      },
      input,
      false
    );
    assert.equal(r.ok, true);
    assert.equal(input.filialId, FILIAL_TIPO);
    assert.equal(input.filialDestinoId, null);
  });

  it("sobrescreve origem/destino na TRANSFERENCIA", () => {
    const input: { filialId?: string; filialDestinoId?: string | null } = {
      filialId: FILIAL_ERRADA,
      filialDestinoId: FILIAL_ERRADA,
    };
    const r = aplicarFiliaisDoTipoOperacional(
      {
        sistema: false,
        rmaEntradaEstoque: false,
        rmaSaidaCliente: false,
        saidaPedidoVenda: false,
        operacao: "TRANSFERENCIA",
        filialId: FILIAL_TIPO,
        filialDestinoId: FILIAL_DEST,
      },
      input,
      false
    );
    assert.equal(r.ok, true);
    assert.equal(input.filialId, FILIAL_TIPO);
    assert.equal(input.filialDestinoId, FILIAL_DEST);
  });

  it("rejeita tipo operacional sem filial", () => {
    const r = aplicarFiliaisDoTipoOperacional(
      {
        sistema: false,
        rmaEntradaEstoque: false,
        rmaSaidaCliente: false,
        saidaPedidoVenda: false,
        operacao: "SAIDA",
        filialId: null,
        filialDestinoId: null,
      },
      { filialId: FILIAL_ERRADA },
      false
    );
    assert.equal(r.ok, false);
  });

  it("não altera body em tipo de pedido / uso interno", () => {
    const input = { filialId: FILIAL_ERRADA };
    const r = aplicarFiliaisDoTipoOperacional(
      {
        sistema: false,
        rmaEntradaEstoque: false,
        rmaSaidaCliente: false,
        saidaPedidoVenda: true,
        operacao: "SAIDA",
        filialId: null,
        filialDestinoId: null,
      },
      input,
      false
    );
    assert.equal(r.ok, true);
    assert.equal(input.filialId, FILIAL_ERRADA);
  });
});
