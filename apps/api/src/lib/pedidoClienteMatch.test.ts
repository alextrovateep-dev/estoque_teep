import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cnpjFromRaiz } from "@teep/shared";
import {
  clienteIdPorDocumento,
  indexClientesPorCnpj,
  interpretarDocumentoContatoEgestor,
  mensagemBloqueioSeparacaoCliente,
  MSG_PEDIDO_CPF_NAO_ACEITO,
  MSG_PEDIDO_SEM_CNPJ_EGESTOR,
} from "./pedidoClienteMatch";

describe("interpretarDocumentoContatoEgestor", () => {
  it("exige CNPJ", () => {
    assert.equal(
      interpretarDocumentoContatoEgestor("").bloqueio,
      MSG_PEDIDO_SEM_CNPJ_EGESTOR
    );
  });

  it("rejeita CPF", () => {
    assert.equal(
      interpretarDocumentoContatoEgestor("529.982.247-25").bloqueio,
      MSG_PEDIDO_CPF_NAO_ACEITO
    );
  });

  it("aceita CNPJ válido", () => {
    const cnpj = cnpjFromRaiz("11222333");
    const r = interpretarDocumentoContatoEgestor(cnpj.replace(/\D/g, ""));
    assert.equal(r.bloqueio, null);
    assert.ok(r.documentoContato);
  });
});

describe("mensagemBloqueioSeparacaoCliente", () => {
  it("bloqueia sem cliente match", () => {
    const cnpj = cnpjFromRaiz("11222333");
    const msg = mensagemBloqueioSeparacaoCliente({
      documentoContato: cnpj,
      clienteId: null,
    });
    assert.match(String(msg), /não encontrado/i);
  });

  it("libera com cliente", () => {
    const cnpj = cnpjFromRaiz("11222333");
    assert.equal(
      mensagemBloqueioSeparacaoCliente({
        documentoContato: cnpj,
        clienteId: "uuid",
      }),
      null
    );
  });
});

describe("indexClientesPorCnpj", () => {
  it("casa por dígitos ignorando máscara", () => {
    const cnpj = cnpjFromRaiz("11222333");
    const idx = indexClientesPorCnpj([
      { id: "a", documento: cnpj, ativo: true },
    ]);
    assert.equal(clienteIdPorDocumento(idx, cnpj.replace(/\D/g, "")), "a");
  });
});
