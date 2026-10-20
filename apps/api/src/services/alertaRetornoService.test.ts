import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linhaSeriesSaida } from "./alertaRetornoService";

describe("linhaSeriesSaida", () => {
  it("omite quando não há série", () => {
    assert.equal(linhaSeriesSaida([]), null);
    assert.equal(linhaSeriesSaida(["  ", ""]), null);
  });

  it("uma série numa linha", () => {
    assert.equal(
      linhaSeriesSaida([" TPM1122240134 "]),
      "Número de série: TPM1122240134"
    );
  });

  it("várias séries em lista, sem duplicar", () => {
    const r = linhaSeriesSaida(["SN-B", "SN-A", "SN-B"]);
    assert.equal(r, "Números de série:\n• SN-A\n• SN-B");
  });
});
