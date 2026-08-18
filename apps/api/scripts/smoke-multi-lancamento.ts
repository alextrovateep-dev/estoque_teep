/**
 * Smoke — lançamento multi-SKU (ENTRADA / SAÍDA com série / TRANSFERÊNCIA)
 * Pré: API no ar, migrate + seed
 */
import "dotenv/config";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { cnpjFromRaiz } from "@teep/shared";

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
  console.log(`\nMulti-SKU lançamento smoke → ${API}\n`);

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
  const tbo = filiais.find((f) => f.sigla === "TBO");
  if (!pln || !tbo) fail("filiais PLN/TBO ausentes");

  const cats = await req<Array<{ id: string }>>("/categorias", { token });
  if (!cats[0]) fail("categoria ausente");

  const tipos = await req<
    Array<{ id: string; nome: string; operacao: string; sistema: boolean }>
  >("/tipos-movimentacao", { token });
  const tipoCompra = tipos.find((t) => t.nome === "Compra" && !t.sistema);
  const tipoVenda = tipos.find(
    (t) => t.nome === "Venda / Entrega" && !t.sistema
  );
  const tipoTransf = tipos.find(
    (t) =>
      t.operacao === "TRANSFERENCIA" &&
      !t.sistema &&
      (t.nome === "Transferência entre estoques" ||
        (!/árvore|arvore/i.test(t.nome) && t.nome.toLowerCase().includes("transfer")))
  );
  if (!tipoCompra || !tipoTransf) fail("tipos Compra/Transferência ausentes");

  const clientes = await req<Array<{ id: string }>>("/clientes", { token });
  let clienteId = clientes[0]?.id;
  if (!clienteId) {
    const c = await req<{ id: string }>("/clientes", {
      method: "POST",
      token,
      body: {
        nome: "Forn Smoke Multi",
        tipo: "FORNECEDOR",
        documento: cnpjFromRaiz(`1${String(Date.now()).slice(-7)}`),
      },
      expectStatus: 201,
    });
    clienteId = c.id;
  }

  const suf = Date.now().toString(36).slice(-5).toUpperCase();

  // --- Produtos sem série (entrada multi) ---
  const pA = await req<{ id: string; codigo: string }>("/produtos", {
    method: "POST",
    token,
    body: {
      codigo: `MA${suf}`,
      descricao: `Multi A ${suf}`,
      categoriaId: cats[0].id,
      unidade: "UN",
      controlaSerie: false,
    },
    expectStatus: 201,
  });
  const pB = await req<{ id: string; codigo: string }>("/produtos", {
    method: "POST",
    token,
    body: {
      codigo: `MB${suf}`,
      descricao: `Multi B ${suf}`,
      categoriaId: cats[0].id,
      unidade: "UN",
      controlaSerie: false,
    },
    expectStatus: 201,
  });
  ok(`produtos sem série ${pA.codigo}/${pB.codigo}`);

  const entrada = await req<{
    fluxo?: string;
    grupoLancamentoId?: string;
    movimentacoes?: Array<{ id: string }>;
    movimentacao?: { id: string };
  }>("/movimentacoes", {
    method: "POST",
    token,
    body: {
      tipoId: tipoCompra.id,
      filialId: pln.id,
      clienteId,
      itens: [
        { produtoId: pA.id, quantidade: 5 },
        { produtoId: pB.id, quantidade: 3 },
      ],
      observacao: "SMOKE-MULTI-ENTRADA",
    },
  });
  if (entrada.fluxo !== "LANCAMENTO_GRUPO") {
    fail("entrada multi deveria retornar LANCAMENTO_GRUPO", entrada);
  }
  if (!entrada.grupoLancamentoId) fail("grupoLancamentoId ausente", entrada);
  if ((entrada.movimentacoes?.length || 0) !== 2) {
    fail("esperava 2 movimentações", entrada);
  }
  ok(`entrada multi grupo=${entrada.grupoLancamentoId}`);

  // --- Produtos com série: entrada → saída multi ---
  const sA = await req<{ id: string; codigo: string }>("/produtos", {
    method: "POST",
    token,
    body: {
      codigo: `SA${suf}`,
      descricao: `Serie A ${suf}`,
      categoriaId: cats[0].id,
      unidade: "UN",
      controlaSerie: true,
      configuracaoSerie: {
        formato: "{codigo}-{seq4}",
        geracaoAutomatica: true,
        tamanhoSequencial: 4,
      },
    },
    expectStatus: 201,
  });
  const sB = await req<{ id: string; codigo: string }>("/produtos", {
    method: "POST",
    token,
    body: {
      codigo: `SB${suf}`,
      descricao: `Serie B ${suf}`,
      categoriaId: cats[0].id,
      unidade: "UN",
      controlaSerie: true,
      configuracaoSerie: {
        formato: "{codigo}-{seq4}",
        geracaoAutomatica: true,
        tamanhoSequencial: 4,
      },
    },
    expectStatus: 201,
  });
  ok(`produtos com série ${sA.codigo}/${sB.codigo}`);

  const alocA = await req<{ series: string[]; alocacaoId: string }>(
    "/series/alocar",
    {
      method: "POST",
      token,
      body: { produtoId: sA.id, quantidade: 2 },
      expectStatus: 201,
    }
  );
  const alocB = await req<{ series: string[]; alocacaoId: string }>(
    "/series/alocar",
    {
      method: "POST",
      token,
      body: { produtoId: sB.id, quantidade: 2 },
      expectStatus: 201,
    }
  );

  await req("/movimentacoes", {
    method: "POST",
    token,
    body: {
      tipoId: tipoCompra.id,
      filialId: pln.id,
      clienteId,
      itens: [
        { produtoId: sA.id, quantidade: 2, series: alocA.series },
        { produtoId: sB.id, quantidade: 2, series: alocB.series },
      ],
      observacao: "SMOKE-MULTI-ENTRADA-SERIE",
    },
  });
  ok("entrada multi com séries");

  const valid = await req<{ ok: boolean }>("/series/validar-saida", {
    method: "POST",
    token,
    body: {
      produtoId: sA.id,
      filialId: pln.id,
      numero: alocA.series[0],
    },
  });
  if (!valid.ok) fail("validar-saida deveria aceitar série em estoque", valid);
  ok("POST /series/validar-saida");

  // Tipo saída: Venda / Entrega (sem baixa por árvore)
  const tipoSaida =
    tipoVenda ||
    tipos.find(
      (t) =>
        t.operacao === "SAIDA" &&
        !t.sistema &&
        !/árvore|arvore|rma|demonstra|comodato/i.test(t.nome)
    );
  if (!tipoSaida) fail("tipo SAIDA adequado ausente");

  const saida = await req<{
    fluxo?: string;
    grupoLancamentoId?: string;
    movimentacoes?: Array<{ id: string }>;
  }>("/movimentacoes", {
    method: "POST",
    token,
    body: {
      tipoId: tipoSaida.id,
      filialId: pln.id,
      clienteId,
      itens: [
        {
          produtoId: sA.id,
          quantidade: 2,
          series: alocA.series,
        },
        {
          produtoId: sB.id,
          quantidade: 2,
          series: alocB.series,
        },
      ],
      observacao: "SMOKE-MULTI-SAIDA-SERIE",
    },
  });
  if (saida.fluxo !== "LANCAMENTO_GRUPO") {
    fail("saída multi deveria retornar LANCAMENTO_GRUPO", saida);
  }
  ok(`saída multi com séries grupo=${saida.grupoLancamentoId}`);

  // --- Transferência 2 itens (sem série) — usa saldo da entrada multi ---
  const transf = await req<{
    fluxo?: string;
    transferencia?: { id: string; status: string };
  }>("/movimentacoes", {
    method: "POST",
    token,
    body: {
      tipoId: tipoTransf.id,
      filialId: pln.id,
      filialDestinoId: tbo.id,
      creditoDestino: "IMEDIATO",
      itens: [
        { produtoId: pA.id, quantidade: 2 },
        { produtoId: pB.id, quantidade: 1 },
      ],
      observacao: "SMOKE-MULTI-TRANSF",
    },
  });
  if (transf.fluxo !== "TRANSFERENCIA") {
    fail("transferência multi deveria retornar TRANSFERENCIA", transf);
  }
  ok(
    `transferência multi status=${transf.transferencia?.status || "?"}`
  );

  console.log("\nOK — multi-SKU smoke passou\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
