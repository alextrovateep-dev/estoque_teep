/**
 * Smoke: ranking de saídas do mês atual (tool do assistente).
 * Uso: npx tsx scripts/smoke-rank-saidas.ts
 */
import { executeTool } from "../src/services/assistente/tools";
import type { AuthUser } from "../src/middleware/auth";

const admin: AuthUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@test",
  nome: "Admin",
  perfil: "ADMIN",
  filialId: null as unknown as string,
  filialIds: [],
};

async function main() {
  const r = await executeTool(
    "rank_product_movements",
    { periodo: "mes_atual", sentido: "saida", limit: 8 },
    { user: admin, filialHint: null, permissoes: null }
  );
  console.log(JSON.stringify(r, null, 2));

  const bad = await executeTool(
    "list_stock_movements",
    { de: "01/08/2026", ate: "10/08/2026", operacao: "SAIDA" },
    { user: admin, filialHint: null, permissoes: null }
  );
  console.log("bad date parse:", JSON.stringify(bad, null, 2));

  const abertos = await executeTool(
    "list_stock_movements",
    {
      de: "2026-08-01",
      ate: "2026-08-31",
      somenteAbertos: true,
    },
    { user: admin, filialHint: null, permissoes: null }
  );
  console.log(
    "somenteAbertos agosto encontrados:",
    (abertos as { encontrados?: number }).encontrados
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
