import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escopoRetornoClienteDeTipo,
  tipoEntradaEhRetornoCliente,
  tipoUsaBaixaArvore,
  tipoVisivelFiltroMovimentacoes,
  tipoVisivelLancamento,
} from "@teep/shared";

describe("tipoEntradaEhRetornoCliente", () => {
  it("reconhece vínculo cadastrado", () => {
    assert.equal(
      tipoEntradaEhRetornoCliente({
        operacao: "ENTRADA",
        ehRetornoDeId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        nome: "EDSP",
      }),
      true
    );
  });

  it("reconhece nome com retorno de demonstração mesmo sem vínculo", () => {
    assert.equal(
      tipoEntradaEhRetornoCliente({
        operacao: "ENTRADA",
        ehRetornoDeId: null,
        nome: "EDSP — Entrada Retorno de Demonstração - SP (ENTRADA)",
        codigo: "EDSP",
      }),
      true
    );
  });

  it("reconhece retorno de comodato sem vínculo", () => {
    assert.equal(
      tipoEntradaEhRetornoCliente({
        operacao: "ENTRADA",
        nome: "Retorno Comodato",
        codigo: "ECSP",
      }),
      true
    );
  });

  it("não trata compra, RMA nem retorno genérico como demo/comodato", () => {
    assert.equal(
      tipoEntradaEhRetornoCliente({
        operacao: "ENTRADA",
        nome: "Entrada de compra",
      }),
      false
    );
    assert.equal(
      tipoEntradaEhRetornoCliente({
        operacao: "ENTRADA",
        nome: "Retorno RMA",
        rmaEntradaEstoque: true,
      }),
      false
    );
    assert.equal(
      tipoEntradaEhRetornoCliente({
        operacao: "SAIDA",
        nome: "Saída Demonstração",
      }),
      false
    );
    assert.equal(
      tipoEntradaEhRetornoCliente({
        operacao: "ENTRADA",
        nome: "Retorno de garantia",
      }),
      false
    );
  });
});

describe("escopoRetornoClienteDeTipo", () => {
  it("separa demonstração e comodato", () => {
    assert.equal(
      escopoRetornoClienteDeTipo({
        nome: "Entrada Retorno de Demonstração",
      }),
      "demo"
    );
    assert.equal(
      escopoRetornoClienteDeTipo({ nome: "Saída Comodato" }),
      "comodato"
    );
    assert.equal(escopoRetornoClienteDeTipo({ nome: "Entrada" }), null);
  });
});

describe("tipoUsaBaixaArvore", () => {
  it("só explode BOM com a flag ligada", () => {
    assert.equal(tipoUsaBaixaArvore({ baixaPorArvore: false }), false);
    assert.equal(tipoUsaBaixaArvore({}), false);
    assert.equal(tipoUsaBaixaArvore({ baixaPorArvore: true }), true);
  });

  it("saída de pedido nunca explode BOM", () => {
    assert.equal(
      tipoUsaBaixaArvore({
        baixaPorArvore: true,
        saidaPedidoVenda: true,
      }),
      false
    );
  });
});

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
