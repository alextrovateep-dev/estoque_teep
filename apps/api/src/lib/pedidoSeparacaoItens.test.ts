import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agruparItensSaidaPedido,
  alocarSeriesSeparacao,
  alinharItensPedidoEgestor,
  codigoItemEgestor,
} from "./pedidoSeparacaoItens";

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

describe("alocarSeriesSeparacao", () => {
  it("reparte séries do mesmo SKU entre as linhas", () => {
    const out = alocarSeriesSeparacao(
      [
        { id: "i1", produtoId: "a", quantidade: 1 },
        { id: "i2", produtoId: "a", quantidade: 1 },
      ],
      new Map([["a", ["S1", "S2"]]])
    );
    assert.deepEqual(out.i1, ["S1"]);
    assert.deepEqual(out.i2, ["S2"]);
  });

  it("coloca sobra na última linha do produto", () => {
    const out = alocarSeriesSeparacao(
      [{ id: "i1", produtoId: "a", quantidade: 1 }],
      new Map([["a", ["S1", "S2"]]])
    );
    assert.deepEqual(out.i1, ["S1", "S2"]);
  });
});

describe("codigoItemEgestor", () => {
  it("usa o código da linha e evita duplicata", () => {
    const used = new Set<number>();
    assert.equal(codigoItemEgestor(10, 0, used), 10);
    assert.equal(codigoItemEgestor(10, 1, used), 2);
    assert.equal(codigoItemEgestor(undefined, 2, used), 3);
  });
});

describe("alinharItensPedidoEgestor", () => {
  const ent = (
    codigo: number,
    sku: string,
    extra?: Partial<{ quantidade: number; produtoId: string | null }>
  ) => ({
    egestorItemCodigo: codigo,
    codigoProprio: sku,
    descricao: sku,
    quantidade: extra?.quantidade ?? 1,
    produtoId: extra?.produtoId ?? "p1",
  });

  it("preserva o id quando o código da linha eGestor continua o mesmo", () => {
    const r = alinharItensPedidoEgestor(
      [{ id: "uuid-a", egestorItemCodigo: 7, codigoProprio: "TTP-1" }],
      [ent(7, "TTP-1")]
    );
    assert.deepEqual(r.removerIds, []);
    assert.equal(r.criar.length, 0);
    assert.equal(r.atualizar[0]?.id, "uuid-a");
    assert.equal(r.atualizar[0]?.codigoProprio, "TTP-1");
  });

  it("reusa o id pelo SKU se o código da linha eGestor mudou", () => {
    const r = alinharItensPedidoEgestor(
      [{ id: "uuid-a", egestorItemCodigo: 1, codigoProprio: "TTP-1" }],
      [ent(99, "TTP-1")]
    );
    assert.equal(r.atualizar[0]?.id, "uuid-a");
    assert.equal(r.atualizar[0]?.egestorItemCodigo, 99);
    assert.equal(r.criar.length, 0);
  });

  it("cria linha nova e remove a que saiu do pedido", () => {
    const r = alinharItensPedidoEgestor(
      [{ id: "old", egestorItemCodigo: 1, codigoProprio: "A" }],
      [ent(2, "B")]
    );
    assert.deepEqual(r.removerIds, ["old"]);
    assert.equal(r.criar[0]?.codigoProprio, "B");
  });
});
