import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { grupoPedidoReabreAposEstorno } from "./pedidoVendaService";

describe("grupoPedidoReabreAposEstorno", () => {
  it("reabre SEPARADO quando todas as saídas originais foram estornadas", () => {
    assert.equal(
      grupoPedidoReabreAposEstorno("SEPARADO", [
        { status: "ESTORNADO" },
        { status: "ESTORNADO" },
      ]),
      true
    );
  });

  it("não reabre se ainda resta saída CONCLUIDO no grupo", () => {
    assert.equal(
      grupoPedidoReabreAposEstorno("SEPARADO", [
        { status: "ESTORNADO" },
        { status: "CONCLUIDO" },
      ]),
      false
    );
  });

  it("não reabre pedido já ENVIADO", () => {
    assert.equal(
      grupoPedidoReabreAposEstorno("ENVIADO", [{ status: "ESTORNADO" }]),
      false
    );
  });

  it("não reabre ABERTO (fica no sync de rejeição/pendente)", () => {
    assert.equal(
      grupoPedidoReabreAposEstorno("ABERTO", [{ status: "ESTORNADO" }]),
      false
    );
  });
});
