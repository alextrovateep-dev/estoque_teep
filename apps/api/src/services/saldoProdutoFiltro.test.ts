import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aplicarCodigoProdutoLista,
  matchSaldoProdutoLista,
  tokenDigitandoCodigoProduto,
  tokensCodigoProduto,
  tokensCodigoProdutoTravados,
} from "@teep/shared";

describe("filtro de vários códigos no dashboard", () => {
  it("quebra por vírgula e ignora vazio", () => {
    assert.deepEqual(tokensCodigoProduto("TMP-1, TMP-2, "), ["TMP-1", "TMP-2"]);
  });

  it("sugestão usa só o trecho depois da última vírgula", () => {
    assert.equal(tokenDigitandoCodigoProduto("TMP-1, abc"), "abc");
    assert.equal(tokenDigitandoCodigoProduto("TMP-1, "), "");
  });

  it("ao escolher um código, coloca vírgula para o próximo", () => {
    assert.equal(aplicarCodigoProdutoLista("", "TMP-1122"), "TMP-1122, ");
    assert.equal(
      aplicarCodigoProdutoLista("TMP-1122, tm", "TMP-1144-W"),
      "TMP-1122, TMP-1144-W, "
    );
  });

  it("enquanto digita o segundo, o primeiro já está travado", () => {
    assert.deepEqual(tokensCodigoProdutoTravados("TMP-1, x"), ["TMP-1"]);
    assert.deepEqual(tokensCodigoProdutoTravados("tmp"), []);
  });

  it("dois códigos completos sem vírgula no fim continuam os dois", () => {
    const rows = [{ codigo: "TMP-1" }, { codigo: "TMP-2" }];
    assert.deepEqual(tokensCodigoProdutoTravados("TMP-1, TMP-2", rows), [
      "TMP-1",
      "TMP-2",
    ]);
  });

  it("lista mostra os dois SKUs, sem prefixo extra", () => {
    const rows = [
      { codigo: "TMP-1144-W", descricao: "W" },
      { codigo: "TMP-1144-WE", descricao: "WE" },
      { codigo: "TMP-1122", descricao: "A" },
    ];
    const q = "TMP-1144-W, TMP-1122";
    assert.equal(matchSaldoProdutoLista(rows[0]!, q, rows), true);
    assert.equal(matchSaldoProdutoLista(rows[1]!, q, rows), false);
    assert.equal(matchSaldoProdutoLista(rows[2]!, q, rows), true);
  });
});
