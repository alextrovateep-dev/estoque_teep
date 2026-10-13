import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deveFicarPendenteAprovacao, reativarSaidoNoLancamento } from "./movimentacaoService";
import { serieEntradaAceitaExistente } from "./serieService";

describe("deveFicarPendenteAprovacao", () => {
  it("operador + tipo com aprovação → pendente no lançamento manual", () => {
    assert.equal(
      deveFicarPendenteAprovacao({
        perfil: "OPERADOR",
        requerAprovacao: true,
      }),
      true
    );
  });

  it("usoInternoRma nunca fica pendente", () => {
    assert.equal(
      deveFicarPendenteAprovacao({
        perfil: "OPERADOR",
        requerAprovacao: true,
        usoInternoRma: true,
      }),
      false
    );
  });

  it("usoInternoPedido nunca fica pendente", () => {
    assert.equal(
      deveFicarPendenteAprovacao({
        perfil: "OPERADOR",
        requerAprovacao: true,
        usoInternoPedido: true,
      }),
      false
    );
  });

  it("gerente ignora requerAprovacao", () => {
    assert.equal(
      deveFicarPendenteAprovacao({
        perfil: "GERENTE",
        requerAprovacao: true,
      }),
      false
    );
  });
});

describe("reativarSaidoNoLancamento", () => {
  it("retorno demo reativa SAIDO mesmo com produto que controla série", () => {
    assert.equal(
      reativarSaidoNoLancamento({ serieLivre: false, ehRetorno: true }),
      true
    );
  });

  it("entrada nova de produto com série não reativa", () => {
    assert.equal(
      reativarSaidoNoLancamento({ serieLivre: false, ehRetorno: false }),
      false
    );
  });
});

describe("serieEntradaAceitaExistente", () => {
  it("só aceita unidade SAIDO quando reativação está ligada", () => {
    assert.equal(
      serieEntradaAceitaExistente({
        permitirReativarSaido: true,
        status: "SAIDO",
      }),
      true
    );
    assert.equal(
      serieEntradaAceitaExistente({
        permitirReativarSaido: true,
        status: "EM_ESTOQUE",
      }),
      false
    );
    assert.equal(
      serieEntradaAceitaExistente({
        permitirReativarSaido: false,
        status: "SAIDO",
      }),
      false
    );
  });
});
