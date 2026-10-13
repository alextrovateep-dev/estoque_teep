import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seriesEmAbertoDaSaida } from "./retornoVinculoHelper";

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
