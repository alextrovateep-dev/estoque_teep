import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deveApagarUnidadeNoEstornoEntrada } from "./serieService";

describe("deveApagarUnidadeNoEstornoEntrada", () => {
  it("apaga S/N que nasceu só na entrada estornada", () => {
    assert.equal(
      deveApagarUnidadeNoEstornoEntrada({
        outrosMovimentos: 0,
        cargas: 0,
        rma: 0,
        transformacoes: 0,
      }),
      true
    );
  });

  it("não apaga se já houve outra movimentação (retorno/saída)", () => {
    assert.equal(
      deveApagarUnidadeNoEstornoEntrada({
        outrosMovimentos: 1,
        cargas: 0,
        rma: 0,
        transformacoes: 0,
      }),
      false
    );
  });

  it("não apaga se está em RMA, carga ou transformação", () => {
    assert.equal(
      deveApagarUnidadeNoEstornoEntrada({
        outrosMovimentos: 0,
        cargas: 1,
        rma: 0,
        transformacoes: 0,
      }),
      false
    );
    assert.equal(
      deveApagarUnidadeNoEstornoEntrada({
        outrosMovimentos: 0,
        cargas: 0,
        rma: 1,
        transformacoes: 0,
      }),
      false
    );
    assert.equal(
      deveApagarUnidadeNoEstornoEntrada({
        outrosMovimentos: 0,
        cargas: 0,
        rma: 0,
        transformacoes: 1,
      }),
      false
    );
  });
});
