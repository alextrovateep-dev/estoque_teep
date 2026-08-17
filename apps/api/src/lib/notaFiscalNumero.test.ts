import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chaveNotaFiscalNumero,
  mensagemNotaFiscalDuplicada,
  mesmaNotaFiscalNumero,
  normalizarNotaFiscalNumero,
} from "./notaFiscalNumeroFormat";

describe("notaFiscalNumero", () => {
  it("normaliza vazio e espaços", () => {
    assert.equal(normalizarNotaFiscalNumero(null), null);
    assert.equal(normalizarNotaFiscalNumero("  "), null);
    assert.equal(normalizarNotaFiscalNumero(" 12345 "), "12345");
  });

  it("trata o mesmo número com caixa e espaços como igual", () => {
    assert.equal(chaveNotaFiscalNumero("NF 123"), "nf123");
    assert.equal(chaveNotaFiscalNumero("12 345"), "12345");
    assert.equal(mesmaNotaFiscalNumero("NF 123", "nf123"), true);
    assert.equal(mesmaNotaFiscalNumero("12345", "12 345"), true);
    assert.equal(mesmaNotaFiscalNumero("123", "124"), false);
    assert.equal(mesmaNotaFiscalNumero("", "123"), false);
  });

  it("mensagem cita a operação", () => {
    assert.match(
      mensagemNotaFiscalDuplicada("ENTRADA", "12345"),
      /12345.*entrada/
    );
    assert.match(
      mensagemNotaFiscalDuplicada("SAIDA", "99"),
      /saída/
    );
    assert.match(
      mensagemNotaFiscalDuplicada("TRANSFERENCIA", "A"),
      /transferência/
    );
    assert.match(
      mensagemNotaFiscalDuplicada("COBRANCA", "B"),
      /cobrança/
    );
  });
});
