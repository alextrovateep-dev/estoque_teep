import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filtroTipoSaidaDemoComodato,
  seriesEmAbertoDaSaida,
} from "./retornoVinculoHelper";

describe("filtroTipoSaidaDemoComodato", () => {
  it("aceita saída com alerta de retorno ou termo de comodato", () => {
    assert.deepEqual(filtroTipoSaidaDemoComodato(), {
      OR: [
        { geraAlertaRetorno: true },
        { requerTermoComodato: true },
        { nome: { contains: "Demonstr", mode: "insensitive" } },
        { nome: { contains: "Comodato", mode: "insensitive" } },
      ],
    });
  });

  it("restringe demonstração e comodato", () => {
    const demo = filtroTipoSaidaDemoComodato("demo");
    const comodato = filtroTipoSaidaDemoComodato("comodato");
    assert.equal(Array.isArray(demo.OR), true);
    assert.equal(
      JSON.stringify(comodato).includes("Comodato"),
      true
    );
    assert.equal(JSON.stringify(demo).includes("Demonstr"), true);
  });
});

describe("seriesEmAbertoDaSaida", () => {
  it("traz os S/N da saída que ainda estão SAIDO", () => {
    assert.deepEqual(
      seriesEmAbertoDaSaida({
        seriesSaida: [
          { numeroSerie: "ABC001", status: "SAIDO" },
          { numeroSerie: "ABC002", status: "SAIDO" },
        ],
        seriesOcupadas: [],
      }),
      ["ABC001", "ABC002"]
    );
  });

  it("omite S/N já cobertos por retorno (ignora maiúsculas)", () => {
    assert.deepEqual(
      seriesEmAbertoDaSaida({
        seriesSaida: [
          { numeroSerie: "ABC001", status: "SAIDO" },
          { numeroSerie: "ABC002", status: "SAIDO" },
        ],
        seriesOcupadas: ["abc001"],
      }),
      ["ABC002"]
    );
  });

  it("omite unidade que já voltou ao estoque", () => {
    assert.deepEqual(
      seriesEmAbertoDaSaida({
        seriesSaida: [
          { numeroSerie: "ABC001", status: "EM_ESTOQUE" },
          { numeroSerie: "ABC002", status: "SAIDO" },
        ],
        seriesOcupadas: [],
      }),
      ["ABC002"]
    );
  });
});
