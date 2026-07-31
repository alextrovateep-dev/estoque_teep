/** Extra smoke — F15 IMEDIATO + papéis */
import "dotenv/config";

const API = process.env.API_URL || "http://localhost:4000";

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API}${path}`, init);
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

async function main() {
  const login = await json<{ accessToken: string }>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.SEED_ADMIN_EMAIL || "admin@teep.com.br",
      senha: process.env.SEED_ADMIN_PASSWORD || "Admin@123",
    }),
  });
  if (login.status !== 200) throw new Error(`login ${login.status}`);
  const h = {
    Authorization: `Bearer ${login.data.accessToken}`,
    "Content-Type": "application/json",
  };

  const tipos = (await json<Array<{ id: string; nome: string; sistema: boolean }>>(
    "/tipos-movimentacao",
    { headers: h }
  )).data;
  const tipoT = tipos.find(
    (t) => t.nome === "Transferência entre estoques" && !t.sistema
  );
  if (!tipoT) throw new Error("tipo Transferência entre estoques ausente");

  const filiais = (
    await json<Array<{ id: string; sigla: string }>>("/filiais", { headers: h })
  ).data;
  const pln = filiais.find((f) => f.sigla === "PLN")!;
  const tbo = filiais.find((f) => f.sigla === "TBO")!;

  const prodsRaw = await json<
    Array<{ id: string; codigo: string }> | { data: Array<{ id: string; codigo: string }> }
  >("/produtos?limit=20", { headers: h });
  const list = Array.isArray(prodsRaw.data)
    ? prodsRaw.data
    : (prodsRaw.data as { data: Array<{ id: string; codigo: string }> }).data;
  const prod = list.find((p) => p.codigo.startsWith("DEMO")) || list[0];
  if (!prod) throw new Error("sem produto");

  await json("/estoques/inicializacao", {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      filialId: pln.id,
      itens: [{ produtoId: prod.id, saldo: 30 }],
      confirmarReinit: true,
    }),
  });

  const tr = await json<{
    fluxo?: string;
    creditoDestino?: string;
    transferencia?: { status: string };
    error?: string;
  }>("/movimentacoes", {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      tipoId: tipoT.id,
      filialId: pln.id,
      filialDestinoId: tbo.id,
      produtoId: prod.id,
      quantidade: 3,
      creditoDestino: "IMEDIATO",
      observacao: "SMOKE-IMEDIATO",
    }),
  });

  console.log(
    "IMEDIATO",
    tr.status,
    tr.data.transferencia?.status,
    tr.data.creditoDestino,
    tr.data.fluxo || tr.data.error
  );
  if (tr.status !== 201 || tr.data.transferencia?.status !== "RECEBIDO") {
    throw new Error("IMEDIATO esperado RECEBIDO em 201");
  }

  const est = await json<{
    data: Array<{ produtoId: string; saldoAtual: string | number }>;
  }>(`/estoques?filialId=${tbo.id}&limit=500`, { headers: h });
  const row = est.data.data.find((e) => e.produtoId === prod.id);
  const saldo = row ? Number(row.saldoAtual) : NaN;
  console.log("saldoTBO", saldo);
  if (!(saldo >= 3)) throw new Error(`saldo TBO insuficiente: ${saldo}`);

  for (const [email, senha, perfil] of [
    ["gerente@teep.com.br", "Oper@123", "GERENTE"],
    ["operador@teep.com.br", "Oper@123", "OPERADOR"],
  ] as const) {
    const u = await json<{ user: { perfil: string } }>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha }),
    });
    console.log(`login ${email}`, u.status, u.data.user?.perfil);
    if (u.data.user?.perfil !== perfil) throw new Error(`perfil ${email}`);
  }

  const up = await fetch(`${API}/uploads/fotos-perfil/x.jpg`);
  console.log("uploadsSemToken", up.status);
  if (up.status !== 401) throw new Error("uploads deveria ser 401");

  const ready = await json("/ready");
  console.log("ready", ready.data);

  console.log("\nExtra smoke OK\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
