import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clienteSchema,
  cnpjFromRaiz,
  isValidCnpj,
  MSG_CNPJ_OBRIGATORIO,
  updateClienteSchema,
} from "@teep/shared";

describe("isValidCnpj", () => {
  it("aceita CNPJ conhecido e com máscara", () => {
    assert.equal(isValidCnpj("11.222.333/0001-81"), true);
    assert.equal(isValidCnpj("11222333000181"), true);
  });

  it("rejeita vazio, tamanho errado e dígitos repetidos", () => {
    assert.equal(isValidCnpj(""), false);
    assert.equal(isValidCnpj(null), false);
    assert.equal(isValidCnpj("1122233300018"), false);
    assert.equal(isValidCnpj("11.111.111/1111-11"), false);
  });

  it("rejeita 14 dígitos com DV inválido", () => {
    assert.equal(isValidCnpj("11.222.333/0001-00"), false);
  });

  it("cnpjFromRaiz gera CNPJ válido", () => {
    const gerado = cnpjFromRaiz("12345678");
    assert.equal(isValidCnpj(gerado), true);
  });
});

describe("clienteSchema CNPJ", () => {
  it("rejeita cliente sem CNPJ", () => {
    const r = clienteSchema.safeParse({
      nome: "Acme",
      tipo: "CLIENTE",
    });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.equal(r.error.issues[0]?.message, MSG_CNPJ_OBRIGATORIO);
    }
  });

  it("rejeita fornecedor com CNPJ inválido", () => {
    const r = clienteSchema.safeParse({
      nome: "Acme",
      tipo: "FORNECEDOR",
      documento: "11.222.333/0001-00",
    });
    assert.equal(r.success, false);
  });

  it("aceita cliente com CNPJ válido", () => {
    const r = clienteSchema.safeParse({
      nome: "Acme",
      tipo: "CLIENTE",
      documento: "11.222.333/0001-81",
    });
    assert.equal(r.success, true);
  });

  it("interno pode ficar sem CNPJ", () => {
    const r = clienteSchema.safeParse({
      nome: "Estoque interno",
      tipo: "INTERNO",
    });
    assert.equal(r.success, true);
  });

  it("PATCH só de ativo não exige CNPJ", () => {
    const r = updateClienteSchema.safeParse({ ativo: false });
    assert.equal(r.success, true);
    if (r.success) {
      assert.deepEqual(r.data, { ativo: false });
    }
  });
});
