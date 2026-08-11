import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMovimentacoesWhere,
  parseMovimentacoesFiltroQuery,
} from "./movimentacoesExportService";
import type { AuthUser } from "../middleware/auth";

const admin: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@teep.com.br",
  nome: "Admin",
  perfil: "ADMIN",
  filialId: null,
  filialIds: [],
};

describe("filtro numeroSerie em movimentações", () => {
  it("parse lê numeroSerie da query", () => {
    const q = parseMovimentacoesFiltroQuery({
      numeroSerie: " ABC123 ",
      dataInicio: "2026-01-01",
    });
    assert.equal(q.numeroSerie, "ABC123");
    assert.equal(q.dataInicio, "2026-01-01");
  });

  it("com série ≥2 ignora período de datas", () => {
    const where = buildMovimentacoesWhere(admin, {
      numeroSerie: "SN-99",
      dataInicio: "2026-07-01",
      dataFim: "2026-07-31",
    });
    assert.ok(where.series);
    assert.equal(where.dataMovimento, undefined);
  });

  it("série curta (<2) não aplica filtro de série e mantém datas", () => {
    const where = buildMovimentacoesWhere(admin, {
      numeroSerie: "A",
      dataInicio: "2026-07-01",
      dataFim: "2026-07-31",
    });
    assert.equal(where.series, undefined);
    assert.ok(where.dataMovimento);
  });
});
