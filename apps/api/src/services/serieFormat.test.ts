import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatarNumeroSerie,
  gerarSequenciaSeries,
  anoDoisDigitos,
  formatoComTamanho,
  digitosSequenciaLimitados,
  sequenciaNormalizada,
  serieCompletaDeSequencia,
  validarSequenciaSerieTamanho,
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

  it("remove traços do código do produto na série", () => {
    assert.equal(
      formatarNumeroSerie({
        codigoProduto: "TMP-202",
        ano2: 26,
        sequencial: 1,
        tamanhoSequencial: 4,
      }),
      "TMP202260001"
    );
    assert.equal(
      formatarNumeroSerie({
        codigoProduto: "TMP-2020",
        ano2: 26,
        sequencial: 1,
        tamanhoSequencial: 4,
      }),
      "TMP2020260001"
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

  it("limita dígitos da sequência ao tamanho do produto", () => {
    assert.equal(digitosSequenciaLimitados("000023", 4), "0000");
    assert.equal(digitosSequenciaLimitados("23", 4), "23");
    assert.equal(sequenciaNormalizada("23", 4), "0023");
    assert.equal(sequenciaNormalizada("000023", 4), "0000");
  });

  it("serieCompletaDeSequencia não estoura o tamanho", () => {
    assert.equal(
      serieCompletaDeSequencia("TMP202026", "000023", 4, null, {
        finalizar: false,
      }),
      "TMP2020260000"
    );
    assert.equal(
      serieCompletaDeSequencia("TMP202026", "23", 4, null, {
        finalizar: true,
      }),
      "TMP2020260023"
    );
  });

  it("validarSequenciaSerieTamanho exige exatamente N dígitos", () => {
    assert.equal(validarSequenciaSerieTamanho("0023", 4).ok, true);
    assert.equal(validarSequenciaSerieTamanho("000023", 4).ok, false);
    assert.equal(validarSequenciaSerieTamanho("23", 4).ok, false);
  });
});
