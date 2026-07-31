import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALERTA_EVENTO_LABELS,
  isAbaixoMinimo,
  isAcimaMaximo,
} from "@teep/shared";

describe("alerta limiares (F9)", () => {
  it("0 desliga alerta de mínimo e máximo", () => {
    assert.equal(isAbaixoMinimo(0, 0), false);
    assert.equal(isAcimaMaximo(999, 0), false);
  });

  it("dispara com limiar > 0", () => {
    assert.equal(isAbaixoMinimo(5, 5), true);
    assert.equal(isAbaixoMinimo(6, 5), false);
    assert.equal(isAcimaMaximo(10, 10), true);
    assert.equal(isAcimaMaximo(9, 10), false);
  });

  it("labels D34 existem", () => {
    assert.ok(ALERTA_EVENTO_LABELS.ESTOQUE_MINIMO);
    assert.ok(ALERTA_EVENTO_LABELS.ESTOQUE_MAXIMO);
    assert.ok(ALERTA_EVENTO_LABELS.PRECO_AJUSTADO);
    assert.ok(ALERTA_EVENTO_LABELS.DIVERGENCIA_TRANSFERENCIA);
  });
});
