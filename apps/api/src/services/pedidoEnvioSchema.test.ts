import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anexarNotaFiscalPedidoSchema,
  enviarPedidoSchema,
  isPedidoStatus,
  mensagemBloqueioEnvioPedidoLocacao,
  PEDIDO_STATUS,
  separarPedidoSchema,
  tiposAnexosPedidoEnvio,
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
      freteCobrado: false,
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
      freteCobrado: true,
    });
    assert.equal(r.success, true);
  });

  it("rejeita sem anexo de NF", () => {
    const r = enviarPedidoSchema.safeParse({
      nfNumero: "12345",
      nfArquivo: "",
      freteCobrado: true,
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
      freteCobrado: true,
    });
    assert.equal(r.success, false);
  });
});

describe("separarPedidoSchema", () => {
  const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  it("exige tipo de contrato e data prevista", () => {
    const r = separarPedidoSchema.safeParse({
      filialId: uuid,
      destinatarioIds: [uuid],
      itens: [{ id: uuid, quantidade: 1 }],
    });
    assert.equal(r.success, false);
  });

  it("aceita locação com data", () => {
    const r = separarPedidoSchema.safeParse({
      filialId: uuid,
      destinatarioIds: [uuid],
      tipoContrato: "LOCACAO",
      dataPrevistaEntrega: "2026-10-15",
      itens: [{ id: uuid, quantidade: 1 }],
    });
    assert.equal(r.success, true);
  });
});

describe("mensagemBloqueioEnvioPedidoLocacao", () => {
  it("bloqueia locação sem termo de comodato", () => {
    assert.equal(
      mensagemBloqueioEnvioPedidoLocacao({
        tipoContrato: "LOCACAO",
        temTermoComodato: false,
      }),
      "Anexe o termo de comodato para enviar pedido de locação"
    );
    assert.equal(
      mensagemBloqueioEnvioPedidoLocacao({
        tipoContrato: "LOCACAO",
        temTermoComodato: true,
      }),
      null
    );
    assert.equal(
      mensagemBloqueioEnvioPedidoLocacao({
        tipoContrato: "CONTRATO_ASSISTENCIA",
        temTermoComodato: false,
      }),
      null
    );
  });
});

describe("tiposAnexosPedidoEnvio", () => {
  it("une anexos já salvos com os do body", () => {
    const tipos = tiposAnexosPedidoEnvio(
      [{ tipo: "ADENDO_CONTRATO" }],
      [{ tipo: "TERMO_COMODATO" }]
    );
    assert.equal(tipos.has("ADENDO_CONTRATO"), true);
    assert.equal(tipos.has("TERMO_COMODATO"), true);
    assert.equal(
      mensagemBloqueioEnvioPedidoLocacao({
        tipoContrato: "LOCACAO",
        temTermoComodato: tipos.has("TERMO_COMODATO"),
      }),
      null
    );
  });

  it("bloqueia locação se o termo só existiria no body vazio", () => {
    const tipos = tiposAnexosPedidoEnvio([{ tipo: "ADENDO_CONTRATO" }], []);
    assert.equal(
      mensagemBloqueioEnvioPedidoLocacao({
        tipoContrato: "LOCACAO",
        temTermoComodato: tipos.has("TERMO_COMODATO"),
      }),
      "Anexe o termo de comodato para enviar pedido de locação"
    );
  });
});

describe("enviarPedidoSchema frete", () => {
  const nf =
    "/uploads/notas-fiscais/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-abcdef012345.pdf";
  it("rejeita sem frete cobrado", () => {
    const r = enviarPedidoSchema.safeParse({
      nfNumero: "12345",
      nfArquivo: nf,
    });
    assert.equal(r.success, false);
  });
});
