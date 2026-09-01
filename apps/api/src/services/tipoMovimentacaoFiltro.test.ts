import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tipoVisivelFiltroMovimentacoes } from "@teep/shared";

describe("tipoVisivelFiltroMovimentacoes", () => {
  it("aceita tipo de negócio", () => {
    assert.equal(tipoVisivelFiltroMovimentacoes({ sistema: false }), true);
  });

  it("rejeita tipos internos do sistema", () => {
    assert.equal(tipoVisivelFiltroMovimentacoes({ sistema: true }), false);
  });

  it("rejeita tipos automáticos de RMA", () => {
    assert.equal(
      tipoVisivelFiltroMovimentacoes({ rmaEntradaEstoque: true }),
      false
    );
    assert.equal(
      tipoVisivelFiltroMovimentacoes({ rmaSaidaCliente: true }),
      false
    );
  });

  it("rejeita saída automática de pedido eGestor", () => {
    assert.equal(
      tipoVisivelFiltroMovimentacoes({ saidaPedidoVenda: true }),
      false
    );
  });
});
