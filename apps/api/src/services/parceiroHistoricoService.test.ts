import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bucketHistoricoParceiro,
  isTipoHistoricoParceiroExcluido,
} from "./parceiroHistoricoService";

describe("parceiroHistorico classificação", () => {
  it("exclui Estorno e Devolução", () => {
    assert.equal(isTipoHistoricoParceiroExcluido("Estorno"), true);
    assert.equal(isTipoHistoricoParceiroExcluido("Devolução de Cliente"), true);
    assert.equal(isTipoHistoricoParceiroExcluido("devolucao fornecedor"), true);
    assert.equal(isTipoHistoricoParceiroExcluido("Compra"), false);
    assert.equal(isTipoHistoricoParceiroExcluido("Venda / Entrega"), false);
  });

  it("ENTRADA de compra → comprados; SAIDA de venda → vendidos", () => {
    assert.equal(bucketHistoricoParceiro("ENTRADA", "Compra"), "comprados");
    assert.equal(
      bucketHistoricoParceiro("SAIDA", "Venda / Entrega"),
      "vendidos"
    );
  });

  it("estorno e devolução não entram em nenhum bucket", () => {
    assert.equal(bucketHistoricoParceiro("SAIDA", "Estorno"), null);
    assert.equal(bucketHistoricoParceiro("ENTRADA", "Estorno"), null);
    assert.equal(
      bucketHistoricoParceiro("ENTRADA", "Devolução de Cliente"),
      null
    );
  });

  it("ignora TRANSFERENCIA", () => {
    assert.equal(
      bucketHistoricoParceiro("TRANSFERENCIA", "Transferência Enviada"),
      null
    );
  });
});
