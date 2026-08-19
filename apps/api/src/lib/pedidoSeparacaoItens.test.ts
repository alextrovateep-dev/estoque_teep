import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agruparItensSaidaPedido } from "./pedidoSeparacaoItens";

describe("agruparItensSaidaPedido", () => {
  it("mantém um SKU único", () => {
    const out = agruparItensSaidaPedido([
      { produtoId: "a", quantidade: 2, series: ["S1", "S2"] },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.quantidade, 2);
    assert.deepEqual(out[0]?.series, ["S1", "S2"]);
  });

  it("soma quantidade e concatena séries do mesmo SKU", () => {
    const out = agruparItensSaidaPedido([
      { produtoId: "a", quantidade: 1, series: ["S1"] },
      { produtoId: "a", quantidade: 1, series: ["S2"] },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.quantidade, 2);
    assert.deepEqual(out[0]?.series, ["S1", "S2"]);
  });
});
