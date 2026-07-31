import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dateStampSaoPaulo,
  filtrarSaldosExport,
  totaisDasLinhas,
  type SaldoExportRow,
} from "./saldosExportService";

function row(
  partial: Partial<SaldoExportRow> & Pick<SaldoExportRow, "id" | "codigo">
): SaldoExportRow {
  return {
    filialSigla: "PLN",
    filialNome: "Paulínia",
    descricao: "Item",
    categoriaId: "11111111-1111-1111-1111-111111111111",
    categoriaNome: "Geral",
    saldoAtual: 10,
    estoqueMinimo: 0,
    estoqueMaximo: 0,
    valor: 100,
    abaixoMinimo: false,
    acimaMaximo: false,
    produtoAtivo: true,
    ...partial,
  };
}

describe("saldosExport totais e filtros", () => {
  it("totaisDasLinhas soma qty e valor das linhas", () => {
    const t = totaisDasLinhas([
      row({ id: "a", codigo: "A", saldoAtual: 2, valor: 20.1 }),
      row({ id: "b", codigo: "B", saldoAtual: 3.5, valor: 10.05 }),
    ]);
    assert.equal(t.quantidadeTotal, 5.5);
    assert.equal(t.valorTotal, 30.15);
  });

  it("filtro soAlertas, categoria e busca aplicam juntos", () => {
    const catA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const catB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const rows = [
      row({
        id: "1",
        codigo: "CABO",
        abaixoMinimo: true,
        saldoAtual: 1,
        valor: 5,
        categoriaId: catA,
        categoriaNome: "Cabos",
      }),
      row({
        id: "2",
        codigo: "CABO-OK",
        abaixoMinimo: false,
        saldoAtual: 9,
        valor: 90,
        categoriaId: catA,
        categoriaNome: "Cabos",
      }),
      row({
        id: "3",
        codigo: "FONTE",
        descricao: "Fonte 12V",
        abaixoMinimo: true,
        saldoAtual: 2,
        valor: 20,
        categoriaId: catB,
        categoriaNome: "Fontes",
      }),
    ];
    const out = filtrarSaldosExport(rows, {
      soAlertas: true,
      q: "cabo",
      categoriaId: catA,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.codigo, "CABO");
  });

  it("ids tem prioridade sobre filtros", () => {
    const rows = [
      row({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", codigo: "A" }),
      row({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", codigo: "B" }),
      row({ id: "cccccccc-cccc-cccc-cccc-cccccccccccc", codigo: "C" }),
    ];
    const out = filtrarSaldosExport(rows, {
      soAlertas: true,
      q: "Z",
      ids: [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "cccccccc-cccc-cccc-cccc-cccccccccccc",
      ],
    });
    assert.deepEqual(
      out.map((r) => r.codigo),
      ["A", "C"]
    );
  });

  it("dateStampSaoPaulo retorna YYYY-MM-DD", () => {
    assert.match(
      dateStampSaoPaulo(new Date("2026-07-29T15:00:00.000Z")),
      /^\d{4}-\d{2}-\d{2}$/
    );
  });
});
