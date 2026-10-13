import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatarSaldoProdutoChat,
  inferConsultaSaldo,
  normalizeFilialToolArgs,
} from "./consultaSaldoIntent";

describe("inferConsultaSaldo", () => {
  it("lê SKU e estoque de Vendas", () => {
    const r = inferConsultaSaldo(
      "Quantos módulos do Código TMP-1144-W tem no estoque de Vendas?"
    );
    assert.ok(r);
    assert.equal(r?.codigoOuNome.toUpperCase(), "TMP-1144-W");
    assert.equal(r?.filialSigla?.toLowerCase(), "vendas");
  });

  it("não dispara em pergunta genérica", () => {
    assert.equal(inferConsultaSaldo("olá, tudo bem?"), null);
  });
});

describe("normalizeFilialToolArgs", () => {
  it("converte filialId=Vendas em filialSigla", () => {
    const n = normalizeFilialToolArgs({
      codigoOuNome: "TMP-1144-W",
      filialId: "Vendas",
    });
    assert.equal(n.filialSigla, "Vendas");
    assert.equal(n.filialId, undefined);
  });
});

describe("formatarSaldoProdutoChat", () => {
  it("monta frase com qty no estoque", () => {
    const txt = formatarSaldoProdutoChat({
      encontrado: true,
      produto: { codigo: "TMP-1144-W", descricao: "Módulo", unidade: "UN" },
      saldos: [{ filialSigla: "VEN", filialNome: "Vendas", qty: 12 }],
      qtyTotal: 12,
    });
    assert.match(String(txt), /TMP-1144-W/);
    assert.match(String(txt), /12/);
    assert.match(String(txt), /Vendas/);
  });
});
