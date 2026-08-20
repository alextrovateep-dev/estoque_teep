import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  tipoMovimentacaoSchema,
  validateTipoMovimentacaoMerged,
} from "@teep/shared";

const FILIAL_A = "11111111-1111-4111-8111-111111111111";
const FILIAL_B = "22222222-2222-4222-8222-222222222222";

describe("tipoMovimentacaoSchema — estoque fixo", () => {
  it("ENTRADA sem filialId falha", () => {
    const r = tipoMovimentacaoSchema.safeParse({
      codigo: "ENT-X",
      nome: "Entrada teste",
      operacao: "ENTRADA",
    });
    assert.equal(r.success, false);
  });

  it("ENTRADA com filialId ok", () => {
    const r = tipoMovimentacaoSchema.safeParse({
      codigo: "ENT-X",
      nome: "Entrada teste",
      operacao: "ENTRADA",
      filialId: FILIAL_A,
    });
    assert.equal(r.success, true);
  });

  it("TRANSFERENCIA com origem = destino falha", () => {
    const r = tipoMovimentacaoSchema.safeParse({
      codigo: "TR-X",
      nome: "Transf teste",
      operacao: "TRANSFERENCIA",
      filialId: FILIAL_A,
      filialDestinoId: FILIAL_A,
    });
    assert.equal(r.success, false);
  });

  it("TRANSFERENCIA com origem ≠ destino ok", () => {
    const r = tipoMovimentacaoSchema.safeParse({
      codigo: "TR-X",
      nome: "Transf teste",
      operacao: "TRANSFERENCIA",
      filialId: FILIAL_A,
      filialDestinoId: FILIAL_B,
    });
    assert.equal(r.success, true);
  });

  it("codigo obrigatório", () => {
    const r = tipoMovimentacaoSchema.safeParse({
      nome: "Sem código",
      operacao: "ENTRADA",
      filialId: FILIAL_A,
    });
    assert.equal(r.success, false);
  });

  it("tipo sistema ignora filiais obrigatórias", () => {
    const r = tipoMovimentacaoSchema.safeParse({
      codigo: "SYS-X",
      nome: "Sistema",
      operacao: "ENTRADA",
      sistema: true,
    });
    assert.equal(r.success, true);
  });

  it("saidaPedidoVenda ignora filiais obrigatórias", () => {
    const r = tipoMovimentacaoSchema.safeParse({
      codigo: "SAI-PED",
      nome: "Pedido",
      operacao: "SAIDA",
      saidaPedidoVenda: true,
    });
    assert.equal(r.success, true);
  });
});

describe("validateTipoMovimentacaoMerged — PATCH", () => {
  it("permite operacional sem filial (cutover)", () => {
    const r = validateTipoMovimentacaoMerged(
      {
        codigo: "ENT-X",
        nome: "Entrada",
        operacao: "ENTRADA",
        filialId: null,
      },
      { requireEstoqueFixo: false }
    );
    assert.equal(r.success, true);
  });

  it("rejeita alerta de retorno em ENTRADA no merge", () => {
    const r = validateTipoMovimentacaoMerged(
      {
        codigo: "ENT-X",
        nome: "Entrada",
        operacao: "ENTRADA",
        filialId: FILIAL_A,
        geraAlertaRetorno: true,
        requerCliente: true,
      },
      { requireEstoqueFixo: false }
    );
    assert.equal(r.success, false);
  });

  it("rejeita origem = destino mesmo sem exigir estoque completo", () => {
    const r = validateTipoMovimentacaoMerged(
      {
        codigo: "TR-X",
        nome: "Transf",
        operacao: "TRANSFERENCIA",
        filialId: FILIAL_A,
        filialDestinoId: FILIAL_A,
      },
      { requireEstoqueFixo: false }
    );
    assert.equal(r.success, false);
  });
});
