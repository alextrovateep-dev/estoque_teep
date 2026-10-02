import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  tipoVisivelFiltroMovimentacoes,
  tipoVisivelLancamento,
} from "@teep/shared";

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

describe("tipoVisivelLancamento", () => {
  const admin = { perfil: "ADMIN" };

  it("mostra tipo de negócio sem estoque fixo para admin", () => {
    assert.equal(
      tipoVisivelLancamento(
        { sistema: false, permitidoGerente: true, filialId: null },
        admin
      ),
      true
    );
  });

  it("mostra tipo RMA / pedido no lançamento (são cadastro)", () => {
    assert.equal(
      tipoVisivelLancamento(
        { sistema: false, permitidoGerente: true },
        admin
      ),
      true
    );
  });

  it("esconde tipo sistema", () => {
    assert.equal(
      tipoVisivelLancamento(
        { sistema: true, permitidoGerente: true },
        admin
      ),
      false
    );
  });

  it("operador só vê se a flag e o estoque do tipo baterem", () => {
    const op = { perfil: "OPERADOR", operadorFilialIds: ["fil-a"] };
    assert.equal(
      tipoVisivelLancamento(
        { permitidoOperador: true, filialId: "fil-a" },
        op
      ),
      true
    );
    assert.equal(
      tipoVisivelLancamento(
        { permitidoOperador: true, filialId: "fil-b" },
        op
      ),
      false
    );
    assert.equal(
      tipoVisivelLancamento({ permitidoOperador: false }, op),
      false
    );
  });
});
