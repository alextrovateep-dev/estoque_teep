import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ITEM_STATUS_EM_RMA,
  resolveItemStatusFiltro,
  resolveProcessoStatusFiltro,
} from "./rmaProdutosExportService";

describe("resolveItemStatusFiltro", () => {
  it("default e aliases em_rma retornam EM_ESTOQUE + SEM_MANUTENCAO", () => {
    assert.deepEqual(resolveItemStatusFiltro(undefined), [
      ...ITEM_STATUS_EM_RMA,
    ]);
    assert.deepEqual(resolveItemStatusFiltro(""), [...ITEM_STATUS_EM_RMA]);
    assert.deepEqual(resolveItemStatusFiltro("em_rma"), [
      ...ITEM_STATUS_EM_RMA,
    ]);
    assert.deepEqual(resolveItemStatusFiltro("no_rma"), [
      ...ITEM_STATUS_EM_RMA,
    ]);
  });

  it("todos exclui CANCELADO", () => {
    const out = resolveItemStatusFiltro("todos");
    assert.ok(out.includes("EM_ESTOQUE"));
    assert.ok(out.includes("DEVOLVIDO"));
    assert.ok(!out.includes("CANCELADO"));
  });

  it("status específico é aceito em maiúsculas", () => {
    assert.deepEqual(resolveItemStatusFiltro("DEVOLVIDO"), ["DEVOLVIDO"]);
    assert.deepEqual(resolveItemStatusFiltro("sem_manutencao"), [
      "SEM_MANUTENCAO",
    ]);
  });

  it("valor inválido cai no default em RMA", () => {
    assert.deepEqual(resolveItemStatusFiltro("xyz"), [...ITEM_STATUS_EM_RMA]);
  });
});

describe("resolveProcessoStatusFiltro", () => {
  it("default é ABERTO", () => {
    assert.equal(resolveProcessoStatusFiltro(undefined), "ABERTO");
    assert.equal(resolveProcessoStatusFiltro(""), "ABERTO");
    assert.equal(resolveProcessoStatusFiltro("aberto"), "ABERTO");
  });

  it("todos retorna null (sem filtro)", () => {
    assert.equal(resolveProcessoStatusFiltro("todos"), null);
    assert.equal(resolveProcessoStatusFiltro("all"), null);
  });

  it("status explícito é aceito", () => {
    assert.equal(resolveProcessoStatusFiltro("FECHADO"), "FECHADO");
    assert.equal(resolveProcessoStatusFiltro("cancelado"), "CANCELADO");
  });

  it("valor inválido cai em ABERTO", () => {
    assert.equal(resolveProcessoStatusFiltro("xyz"), "ABERTO");
  });
});
