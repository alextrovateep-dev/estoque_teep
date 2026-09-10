import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deveFicarPendenteAprovacao } from "./movimentacaoService";

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
