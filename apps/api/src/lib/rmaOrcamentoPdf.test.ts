import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rmaItemEntraNoPdfOrcamento } from "@teep/shared";

describe("rmaItemEntraNoPdfOrcamento", () => {
  it("inclui rascunho e negociação", () => {
    assert.equal(
      rmaItemEntraNoPdfOrcamento({
        etapa: "AGUARDANDO_ORCAMENTO",
        orcamentoStatus: "RASCUNHO",
      }),
      true
    );
    assert.equal(
      rmaItemEntraNoPdfOrcamento({
        etapa: "AGUARDANDO_APROVACAO",
        orcamentoStatus: "ENVIADO",
      }),
      true
    );
  });

  it("exclui aprovado, recusado e etapas posteriores", () => {
    assert.equal(
      rmaItemEntraNoPdfOrcamento({
        etapa: "AGUARDANDO_MANUTENCAO",
        orcamentoStatus: "APROVADO",
      }),
      false
    );
    assert.equal(
      rmaItemEntraNoPdfOrcamento({
        etapa: "NAO_APROVADO",
        orcamentoStatus: "RECUSADO",
      }),
      false
    );
    assert.equal(
      rmaItemEntraNoPdfOrcamento({
        etapa: "AGUARDANDO_ENVIO",
        orcamentoStatus: "ENVIADO",
      }),
      false
    );
  });
});
