import "dotenv/config";

const API = process.env.API_URL || "http://localhost:4000";

async function j<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit
): Promise<{ status: number; data: T }> {
  const r = await fetch(`${API}${path}`, init);
  const data = (await r.json().catch(() => ({}))) as T;
  return { status: r.status, data };
}

async function main() {
  const admin = await j<{ accessToken: string }>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@teep.com.br",
      senha: "Admin@123",
    }),
  });
  if (admin.status !== 200) throw new Error(`admin login ${admin.status}`);
  const h = {
    Authorization: `Bearer ${admin.data.accessToken}`,
    "Content-Type": "application/json",
  };

  const filiais = await j<Array<{ id: string; sigla: string }>>("/filiais", {
    headers: h,
  });
  const pln = filiais.data.find((f) => f.sigla === "PLN");
  if (!pln) throw new Error("PLN ausente");

  const email = `temp.${Date.now()}@teep.com.br`;
  const created = await j<{
    id: string;
    deveTrocarSenha: boolean;
    senhaProvisoria: string;
  }>("/usuarios", {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      nome: "User Temp",
      email,
      perfil: "OPERADOR",
      filialId: pln.id,
    }),
  });
  console.log(
    "create",
    created.status,
    created.data.deveTrocarSenha,
    Boolean(created.data.senhaProvisoria)
  );
  if (created.status !== 201 || !created.data.senhaProvisoria) {
    throw new Error(JSON.stringify(created.data));
  }

  const tmp = created.data.senhaProvisoria;
  const login = await j<{
    accessToken: string;
    user: { deveTrocarSenha: boolean };
  }>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha: tmp }),
  });
  console.log("login provisoria", login.status, login.data.user?.deveTrocarSenha);

  const th = {
    Authorization: `Bearer ${login.data.accessToken}`,
    "Content-Type": "application/json",
  };
  const blocked = await j<{ code?: string; error?: string }>("/dashboard", {
    headers: th,
  });
  console.log("dashboard blocked", blocked.status, blocked.data.code || blocked.data.error);

  const change = await j<{ user: { deveTrocarSenha: boolean } }>(
    "/auth/trocar-senha",
    {
      method: "POST",
      headers: th,
      body: JSON.stringify({
        senhaNova: "NovaSenha1",
        senhaNovaConfirmacao: "NovaSenha1",
      }),
    }
  );
  console.log("trocar", change.status, change.data.user?.deveTrocarSenha);

  const ok = await j<{ user: { deveTrocarSenha: boolean } }>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha: "NovaSenha1" }),
  });
  console.log("login nova", ok.status, ok.data.user?.deveTrocarSenha);

  const reset = await j<{ senhaProvisoria: string }>(
    `/usuarios/${created.data.id}/senha-provisoria`,
    { method: "POST", headers: h }
  );
  console.log("reset", reset.status, Boolean(reset.data.senhaProvisoria));

  if (
    created.status !== 201 ||
    blocked.status !== 403 ||
    change.status !== 200 ||
    ok.data.user?.deveTrocarSenha !== false ||
    reset.status !== 200
  ) {
    throw new Error("smoke senha provisoria FALHOU");
  }
  console.log("\nSmoke senha provisoria OK\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
