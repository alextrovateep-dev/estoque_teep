import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatarNumeroSerie,
  gerarSequenciaSeries,
  anoDoisDigitos,
  formatoComTamanho,
} from "@teep/shared";

describe("serieFormat", () => {
  it("formata codigo+ano+seq", () => {
    assert.equal(
      formatarNumeroSerie({
        codigoProduto: "tmp4426",
        ano2: 26,
        sequencial: 1,
        tamanhoSequencial: 4,
      }),
      "TMP4426260001"
    );
  });

  it("respeita formato com hífens e prefixo", () => {
    assert.equal(
      formatarNumeroSerie({
        codigoProduto: "ABC",
        ano2: 26,
        sequencial: 7,
        tamanhoSequencial: 4,
        formato: "{codigo}-{ano2}-{seq4}",
        prefixoFixo: "SN-",
      }),
      "SN-ABC-26-0007"
    );
  });

  it("formatoComTamanho alinha {seqN}", () => {
    assert.equal(
      formatoComTamanho("{codigo}{ano2}{seq4}", 5),
      "{codigo}{ano2}{seq5}"
    );
  });

  it("gera sequência contínua", () => {
    const s = gerarSequenciaSeries({
      codigoProduto: "ABC",
      ano2: 26,
      sequencialInicial: 3,
      quantidade: 3,
      tamanhoSequencial: 4,
    });
    assert.deepEqual(s, ["ABC260003", "ABC260004", "ABC260005"]);
  });

  it("anoDoisDigitos retorna 0-99", () => {
    const a = anoDoisDigitos(new Date("2026-01-01T12:00:00Z"));
    assert.equal(a, 26);
  });
});
