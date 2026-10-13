import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coercePeriodoTransferencia,
  escolherReplyTransferencias,
  formatarListaTransferenciasChat,
  inferConsultaTransferencias,
  normalizeListTransfersRaw,
} from "./consultaTransferenciasIntent";

describe("inferConsultaTransferencias", () => {
  it("reconhece consulta de transferências efetuadas no período", () => {
    const r = inferConsultaTransferencias(
      "Consulta sobre as transferências realizadas no estoque. Liste as transferências efetuadas no período."
    );
    assert.deepEqual(r, { periodo: "mes_atual" });
  });

  it("hoje vs mês passado", () => {
    assert.equal(
      inferConsultaTransferencias("Quais transferências teve hoje?")?.periodo,
      "hoje"
    );
    assert.equal(
      inferConsultaTransferencias("Transferências do mês passado")?.periodo,
      "mes_passado"
    );
  });

  it("não trata criar transferência como consulta", () => {
    assert.equal(
      inferConsultaTransferencias("Quero transferir 20 do PLN para o TBO"),
      null
    );
  });
});

describe("normalizeListTransfersRaw", () => {
  it("padrão mes_atual e ignora status inventado (efetuadas)", () => {
    const n = normalizeListTransfersRaw({ status: "efetuadas" });
    assert.equal(n.periodo, "mes_atual");
    assert.equal(n.status, undefined);
  });

  it("aceita alias de período", () => {
    assert.equal(coercePeriodoTransferencia("este mês"), "mes_atual");
    assert.equal(
      normalizeListTransfersRaw({ periodo: "no periodo" }).periodo,
      "mes_atual"
    );
  });
});

describe("formatarListaTransferenciasChat", () => {
  it("lista cargas para o usuário", () => {
    const txt = formatarListaTransferenciasChat({
      ok: true,
      encontrados: 1,
      total: 1,
      periodo: "mes_atual",
      transferencias: [
        {
          sentido: "PLN → TBO",
          statusLabel: "Recebido",
          criadoEmSp: "13/10/2026 10:00",
          itens: [{ codigo: "SKU1", descricao: "Peça", qtdEnviada: 2 }],
        },
      ],
    });
    assert.match(String(txt), /PLN → TBO/);
    assert.match(String(txt), /SKU1/);
    assert.match(String(txt), /Recebido/);
  });

  it("substitui resposta vazia ou negativa quando há cargas", () => {
    const payload = {
      ok: true,
      encontrados: 1,
      total: 1,
      transferencias: [
        { sentido: "PLN → TBO", statusLabel: "Em trânsito", itens: [] },
      ],
    };
    assert.match(
      escolherReplyTransferencias("", payload, true),
      /PLN → TBO/
    );
    assert.match(
      escolherReplyTransferencias("Não encontrei transferências.", payload, false),
      /PLN → TBO/
    );
  });
});
