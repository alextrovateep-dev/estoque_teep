import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exigeSerieNoLancamento, usaSerieLivre } from "@teep/shared";

describe("exigeSerieNoLancamento / usaSerieLivre", () => {
  it("PRODUTO segue o cadastro do produto", () => {
    assert.equal(
      exigeSerieNoLancamento({
        produtoControlaSerie: true,
        tipoControleSerie: "PRODUTO",
      }),
      true
    );
    assert.equal(
      exigeSerieNoLancamento({
        produtoControlaSerie: false,
        tipoControleSerie: "PRODUTO",
      }),
      false
    );
    assert.equal(
      usaSerieLivre({
        produtoControlaSerie: false,
        tipoControleSerie: "PRODUTO",
      }),
      false
    );
  });

  it("OBRIGATORIO pede série mesmo sem controlaSerie (série livre)", () => {
    assert.equal(
      exigeSerieNoLancamento({
        produtoControlaSerie: false,
        tipoControleSerie: "OBRIGATORIO",
      }),
      true
    );
    assert.equal(
      usaSerieLivre({
        produtoControlaSerie: false,
        tipoControleSerie: "OBRIGATORIO",
      }),
      true
    );
  });

  it("OBRIGATORIO em produto que controla série não é série livre", () => {
    assert.equal(
      exigeSerieNoLancamento({
        produtoControlaSerie: true,
        tipoControleSerie: "OBRIGATORIO",
      }),
      true
    );
    assert.equal(
      usaSerieLivre({
        produtoControlaSerie: true,
        tipoControleSerie: "OBRIGATORIO",
      }),
      false
    );
  });

  it("NAO_USA nunca pede série", () => {
    assert.equal(
      exigeSerieNoLancamento({
        produtoControlaSerie: true,
        tipoControleSerie: "NAO_USA",
      }),
      false
    );
    assert.equal(
      usaSerieLivre({
        produtoControlaSerie: true,
        tipoControleSerie: "NAO_USA",
      }),
      false
    );
  });

  it("tipo omitido equivale a PRODUTO", () => {
    assert.equal(
      exigeSerieNoLancamento({ produtoControlaSerie: true }),
      true
    );
    assert.equal(
      exigeSerieNoLancamento({ produtoControlaSerie: false }),
      false
    );
  });
});
