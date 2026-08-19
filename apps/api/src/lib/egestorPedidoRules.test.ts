import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EGESTOR_SITUACAO_ORCAMENTO,
  isLinhaProdutoEgestor,
  matchCodigoProduto,
  pedidoEgestorCandidatoLista,
  pedidoEgestorNaJanela,
  pedidoEgestorQualifica,
  pedidoTemProdutoEgestor,
} from "./egestorPedidoRules";

describe("pedidoEgestorQualifica", () => {
  it("aceita orçamento em espera", () => {
    assert.equal(
      pedidoEgestorQualifica({
        situacao: EGESTOR_SITUACAO_ORCAMENTO,
        situacaoOS: "Em espera",
      }),
      true
    );
  });

  it("rejeita orçamento sem em espera", () => {
    assert.equal(
      pedidoEgestorQualifica({ situacao: EGESTOR_SITUACAO_ORCAMENTO }),
      false
    );
    assert.equal(
      pedidoEgestorQualifica({
        situacao: EGESTOR_SITUACAO_ORCAMENTO,
        situacaoOS: "Finalizada",
      }),
      false
    );
  });

  it("rejeita venda em espera (não é orçamento)", () => {
    assert.equal(
      pedidoEgestorQualifica({ situacao: 50, situacaoOS: "Em espera" }),
      false
    );
  });

  it("lista: orçamento sem situacaoOS ainda é candidato", () => {
    assert.equal(
      pedidoEgestorCandidatoLista({ situacao: EGESTOR_SITUACAO_ORCAMENTO }),
      true
    );
    assert.equal(
      pedidoEgestorCandidatoLista({
        situacao: EGESTOR_SITUACAO_ORCAMENTO,
        situacaoOS: "Em execução",
      }),
      false
    );
  });

  it("só produto (campo tipo da API real)", () => {
    assert.equal(isLinhaProdutoEgestor("produto"), true);
    assert.equal(isLinhaProdutoEgestor("servico"), false);
    assert.equal(isLinhaProdutoEgestor("serviço"), false);
    assert.equal(pedidoTemProdutoEgestor([{ tipo: "produto" }]), true);
    assert.equal(pedidoTemProdutoEgestor([{ tipoProd: "produto" }]), true);
    assert.equal(pedidoTemProdutoEgestor([{ tipo: "servico" }]), false);
    assert.equal(pedidoTemProdutoEgestor([{}]), false);
  });

  it("OS sem linha produto não entra", () => {
    assert.equal(pedidoTemProdutoEgestor([{ tipoProd: "servico" }]), false);
    assert.equal(pedidoTemProdutoEgestor([]), false);
    assert.equal(
      pedidoTemProdutoEgestor([
        { tipoProd: "servico" },
        { tipoProd: "produto" },
      ]),
      true
    );
  });

  it("match SKU", () => {
    assert.equal(matchCodigoProduto(" TMP-1 ", "tmp-1"), true);
    assert.equal(matchCodigoProduto("A", "B"), false);
  });

  it("janela a partir de 2026-08-01", () => {
    assert.equal(
      pedidoEgestorNaJanela({ dtVenda: "2026-08-01" }, "2026-08-01"),
      true
    );
    assert.equal(
      pedidoEgestorNaJanela({ dtCad: "2026-08-19T12:00:00" }, "2026-08-01"),
      true
    );
    assert.equal(
      pedidoEgestorNaJanela({ dtVenda: "2026-07-31" }, "2026-08-01"),
      false
    );
    assert.equal(
      pedidoEgestorNaJanela(
        { dtVenda: "2026-07-01", dtCad: "2026-08-02" },
        "2026-08-01"
      ),
      true
    );
    assert.equal(
      pedidoEgestorNaJanela({ dtVenda: "19/08/2026" }, "2026-08-01"),
      true
    );
  });
});
