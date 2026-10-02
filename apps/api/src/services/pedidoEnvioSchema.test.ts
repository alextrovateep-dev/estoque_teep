import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anexarNotaFiscalPedidoSchema,
  enviarPedidoSchema,
  isPedidoStatus,
  PEDIDO_STATUS,
} from "@teep/shared";

describe("pedido status", () => {
  it("reconhece as três abas", () => {
    assert.deepEqual([...PEDIDO_STATUS], ["ABERTO", "SEPARADO", "ENVIADO"]);
    assert.equal(isPedidoStatus("SEPARADO"), true);
    assert.equal(isPedidoStatus("AGUARDANDO"), false);
  });
});

describe("enviarPedidoSchema", () => {
  const nf =
    "/uploads/notas-fiscais/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-abcdef012345.pdf";

  it("aceita só NF (transportadora opcional)", () => {
    const r = enviarPedidoSchema.safeParse({
      nfNumero: "12345",
      nfArquivo: nf,
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.transportadora, null);
      assert.equal(r.data.rastreio, null);
    }
  });

  it("aceita transportadora quando informada", () => {
    const r = enviarPedidoSchema.safeParse({
      transportadora: "Jadlog",
      rastreio: "JD123",
      nfNumero: "12345",
      nfArquivo: nf,
    });
    assert.equal(r.success, true);
  });

  it("rejeita sem anexo de NF", () => {
    const r = enviarPedidoSchema.safeParse({
      nfNumero: "12345",
      nfArquivo: "",
    });
    assert.equal(r.success, false);
  });

  it("aceita anexo em pedido enviado", () => {
    const r = anexarNotaFiscalPedidoSchema.safeParse({ nfArquivo: nf });
    assert.equal(r.success, true);
  });

  it("rejeita número da NF vazio", () => {
    const r = enviarPedidoSchema.safeParse({
      nfNumero: "  ",
      nfArquivo: nf,
    });
    assert.equal(r.success, false);
  });
});
