/**
 * Smoke — geração automática + config por produto + desfazer alocação
 * Pré: API no ar, migrate + seed
 */
import "dotenv/config";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const API = process.env.API_URL || "http://localhost:4000";
const EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@teep.com.br";
const SENHA = process.env.SEED_ADMIN_PASSWORD || "Admin@123";

type Json = Record<string, unknown>;
let step = 0;
function ok(msg: string) {
  step += 1;
  console.log(`✔ [${step}] ${msg}`);
}
function fail(msg: string, detail?: unknown): never {
  console.error(`✘ ${msg}`);
  if (detail !== undefined) console.error(detail);
  process.exit(1);
}

async function req<T = Json>(
  pathName: string,
  opts: {
    method?: string;
    token?: string;
    body?: unknown;
    expectStatus?: number;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${API}${pathName}`, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  const okStatus =
    opts.expectStatus !== undefined
      ? res.status === opts.expectStatus
      : res.status >= 200 && res.status < 300;
  if (!okStatus) fail(`${opts.method || "GET"} ${pathName} → ${res.status}`, data);
  return data as T;
}

async function main() {
  console.log(`\nGeração série smoke → ${API}\n`);

  await req("/health");
  ok("health");

  const login = await req<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: { email: EMAIL, senha: SENHA },
  });
  const token = login.accessToken;
  ok("login");

  const filiais = await req<Array<{ id: string; sigla: string }>>("/filiais", {
    token,
  });
  const pln = filiais.find((f) => f.sigla === "PLN");
  if (!pln) fail("PLN ausente");

  const cats = await req<Array<{ id: string }>>("/categorias", { token });
  const tipos = await req<Array<{ id: string; nome: string }>>(
    "/tipos-movimentacao",
    { token }
  );
  const tipoCompra = tipos.find((t) => t.nome === "Compra");
  if (!tipoCompra || !cats[0]) fail("seed incompleto");

  const clientes = await req<Array<{ id: string }>>("/clientes", { token });
  let clienteId = clientes[0]?.id;
  if (!clienteId) {
    const c = await req<{ id: string }>("/clientes", {
      method: "POST",
      token,
      body: { nome: "Forn Smoke Serie", tipo: "FORNECEDOR", documento: null },
      expectStatus: 201,
    });
    clienteId = c.id;
  }

  const suf = Date.now().toString(36).slice(-5).toUpperCase();
  const prod = await req<{
    id: string;
    codigo: string;
    configuracaoSerie?: { formato: string };
  }>("/produtos", {
    method: "POST",
    token,
    body: {
      codigo: `GS${suf}`,
      descricao: `Geracao serie ${suf}`,
      categoriaId: cats[0].id,
      unidade: "UN",
      controlaSerie: true,
      configuracaoSerie: {
        formato: "{codigo}-{ano2}-{seq4}",
        geracaoAutomatica: true,
        tamanhoSequencial: 4,
        prefixoFixo: null,
        sufixoFixo: null,
        reiniciarAnual: true,
      },
    },
    expectStatus: 201,
  });
  if (!prod.configuracaoSerie?.formato?.includes("-")) {
    fail("configuração de formato não persistiu", prod);
  }
  ok(`produto ${prod.codigo} (formato hífen)`);

  // Desfazer: aloca, desfaz, contador volta
  const aloc1 = await req<{
    series: string[];
    alocacaoId: string;
    sequencialFinal: number;
  }>("/series/alocar", {
    method: "POST",
    token,
    body: { produtoId: prod.id, quantidade: 2 },
    expectStatus: 201,
  });
  const ano2 = String(new Date().getFullYear() % 100).padStart(2, "0");
  if (!aloc1.series[0].startsWith(`${prod.codigo}-${ano2}-`)) {
    fail(`formato inesperado ${aloc1.series[0]}`, aloc1);
  }
  if (!aloc1.alocacaoId) fail("faltou alocacaoId", aloc1);
  ok(`alocou ${aloc1.series.join(", ")}`);

  await req("/series/alocar/desfazer", {
    method: "POST",
    token,
    body: { alocacaoId: aloc1.alocacaoId },
  });
  const contAposDesfazer = await req<{ sequencialAtual: number }>(
    `/series/contador/${prod.id}`,
    { token }
  );
  if (contAposDesfazer.sequencialAtual !== 0) {
    fail("contador deveria voltar a 0 após desfazer", contAposDesfazer);
  }
  ok("desfazer reverteu contador");

  // Após desfazer, tentar lançar as mesmas séries deve falhar (409)
  await req("/movimentacoes", {
    method: "POST",
    token,
    body: {
      tipoId: tipoCompra!.id,
      produtoId: prod.id,
      filialId: pln!.id,
      clienteId,
      quantidade: 2,
      series: aloc1.series,
      observacao: "Smoke serie desfeita",
    },
    expectStatus: 409,
  });
  ok("lançar séries desfeitas recusado");

  // Realoca e rejeita lote parcial
  const aloc = await req<{
    series: string[];
    alocacaoId: string;
    sequencialInicial: number;
    sequencialFinal: number;
  }>("/series/alocar", {
    method: "POST",
    token,
    body: { produtoId: prod.id, quantidade: 3 },
    expectStatus: 201,
  });
  if (aloc.series.length !== 3) fail("esperava 3 séries", aloc);
  ok(`realocou ${aloc.series.join(", ")}`);

  await req("/movimentacoes", {
    method: "POST",
    token,
    body: {
      tipoId: tipoCompra!.id,
      produtoId: prod.id,
      filialId: pln!.id,
      clienteId,
      quantidade: 2,
      series: aloc.series.slice(0, 2),
      observacao: "Smoke lote parcial",
    },
    expectStatus: 400,
  });
  ok("lote parcial recusado");

  const buscaAntes = await req<{ data: unknown[] }>(
    `/series?q=${encodeURIComponent(aloc.series[0].slice(0, 8))}`,
    { token }
  );
  const jaExiste = (buscaAntes.data || []).some(
    (r) =>
      typeof r === "object" &&
      r &&
      "numeroSerie" in r &&
      String((r as { numeroSerie: string }).numeroSerie) === aloc.series[0]
  );
  if (jaExiste) fail("série não deveria existir antes do lançamento", buscaAntes);
  ok("ainda sem UnidadeSerie (sem órfão)");

  await req("/movimentacoes", {
    method: "POST",
    token,
    body: {
      tipoId: tipoCompra!.id,
      produtoId: prod.id,
      filialId: pln!.id,
      clienteId,
      quantidade: 3,
      series: aloc.series,
      observacao: "Smoke geração série",
    },
  });
  ok("lançamento entrada CONCLUIDO");

  // Desfazer após confirmar deve falhar
  await req("/series/alocar/desfazer", {
    method: "POST",
    token,
    body: { alocacaoId: aloc.alocacaoId },
    expectStatus: 400,
  });
  ok("desfazer após confirmação recusado");

  const buscaDepois = await req<{
    data: Array<{ numeroSerie: string; status: string; filial?: { sigla: string } }>;
  }>(`/series?q=${encodeURIComponent(aloc.series[0])}`, { token });
  const row = buscaDepois.data?.find((s) => s.numeroSerie === aloc.series[0]);
  if (!row || row.status !== "EM_ESTOQUE" || row.filial?.sigla !== "PLN") {
    fail("série deveria estar EM_ESTOQUE em PLN", row || buscaDepois);
  }
  ok(`série no estoque PLN`);

  const cont = await req<{ sequencialAtual: number }>(
    `/series/contador/${prod.id}`,
    { token }
  );
  if (cont.sequencialAtual < 3) fail("contador não avançou", cont);
  ok(`contador=${cont.sequencialAtual}`);

  console.log("\n✅ Smoke geração de série passou.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
