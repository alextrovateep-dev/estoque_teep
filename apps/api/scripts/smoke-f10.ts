/**
 * Smoke F10 — Homologação via API
 *
 * Pré-requisitos: API no ar, migrate + seed (recomendado SEED_DEMO=1).
 *
 * Uso:
 *   pnpm --filter @teep/api smoke:f10
 *   API_URL=http://localhost:4000 pnpm smoke:f10
 */
import "dotenv/config";
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
  path: string,
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

  const res = await fetch(`${API}${path}`, {
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

  const expect = opts.expectStatus ?? 200;
  const okStatus =
    opts.expectStatus !== undefined
      ? res.status === expect
      : res.status >= 200 && res.status < 300;
  if (!okStatus) {
    fail(`${opts.method || "GET"} ${path} → ${res.status}`, data);
  }
  return data as T;
}

async function main() {
  console.log(`\nF10 smoke → ${API}\n`);

  await req("/health");
  ok("health");

  const login = await req<{
    accessToken: string;
    user: { perfil: string };
  }>("/auth/login", {
    method: "POST",
    body: { email: EMAIL, senha: SENHA },
  });
  const token = login.accessToken;
  ok(`login admin (${login.user.perfil})`);

  const filiais = await req<Array<{ id: string; sigla: string; nome: string }>>(
    "/filiais",
    { token }
  );
  const pln = filiais.find((f) => f.sigla === "PLN");
  const tbo = filiais.find((f) => f.sigla === "TBO");
  if (!pln) fail("Filial PLN não encontrada — rode db:seed");
  ok(`filiais: ${filiais.map((f) => f.sigla).join(", ")}`);

  const categorias = await req<Array<{ id: string; nome: string }>>(
    "/categorias",
    { token }
  );
  const cat = categorias[0];
  if (!cat) fail("Nenhuma categoria — rode db:seed");

  const tipos = await req<
    Array<{ id: string; nome: string; sistema: boolean; operacao?: string }>
  >("/tipos-movimentacao", { token });
  const tipoCompra = tipos.find((t) => t.nome === "Compra");
  const tipoVenda = tipos.find((t) => t.nome === "Venda / Entrega");
  const tipoTransf = tipos.find(
    (t) => t.nome === "Transferência entre estoques" && !t.sistema
  );
  if (!tipoCompra || !tipoVenda) fail("Tipos Compra/Venda ausentes");
  if (!tipoTransf) fail("Tipo Transferência entre estoques ausente — rode db:seed");

  const codigo = `SMOKE-${Date.now().toString(36).toUpperCase()}`;
  const produto = await req<{ id: string; codigo: string }>("/produtos", {
    method: "POST",
    token,
    body: {
      codigo,
      descricao: "Produto smoke F10",
      categoriaId: cat.id,
      unidade: "UN",
      precoUnitario: 10,
      estoqueMinimo: 2,
      estoqueMaximo: 200,
    },
    expectStatus: 201,
  });
  ok(`produto ${produto.codigo}`);

  const cliente = await req<{ id: string }>("/clientes", {
    method: "POST",
    token,
    body: {
      nome: `Cliente Smoke ${codigo}`,
      tipo: "FORNECEDOR",
      documento: cnpjFromRaiz(String(Date.now())),
    },
    expectStatus: 201,
  });
  ok("cliente/fornecedor");

  await req("/estoques/inicializacao", {
    method: "POST",
    token,
    body: {
      filialId: pln.id,
      itens: [{ produtoId: produto.id, saldo: 50 }],
      confirmarReinit: true,
    },
  });
  ok("init saldo PLN = 50");

  const compra = await req<{
    movimentacao: { status: string };
    alertaEstoqueMinimo?: boolean;
  }>("/movimentacoes", {
    method: "POST",
    token,
    body: {
      produtoId: produto.id,
      tipoId: tipoCompra.id,
      filialId: pln.id,
      clienteId: cliente.id,
      quantidade: 10,
      observacao: "smoke F10 compra",
    },
  });
  if (compra.movimentacao.status !== "CONCLUIDO") {
    fail("Compra deveria ser CONCLUIDO", compra);
  }
  ok("lançamento Compra CONCLUIDO (+10)");

  const venda = await req<{ movimentacao: { status: string } }>(
    "/movimentacoes",
    {
      method: "POST",
      token,
      body: {
        produtoId: produto.id,
        tipoId: tipoVenda.id,
        filialId: pln.id,
        clienteId: cliente.id,
        quantidade: 5,
        observacao: "smoke F10 venda",
      },
    }
  );
  if (venda.movimentacao.status !== "CONCLUIDO") {
    fail("Venda deveria ser CONCLUIDO", venda);
  }
  ok("lançamento Venda CONCLUIDO (−5)");

  const estoques = await req<{
    data: Array<{ produtoId: string; saldoAtual: string | number }>;
  }>(`/estoques?filialId=${pln.id}&limit=500`, { token });
  const row = estoques.data.find((e) => e.produtoId === produto.id);
  const saldo = row ? Number(row.saldoAtual) : NaN;
  if (saldo !== 55) {
    fail(`Saldo PLN esperado 55 (50+10−5), obtido ${saldo}`, row);
  }
  ok(`saldo PLN conferido = ${saldo}`);

  const dash = await req<{ kpis: { alertasEstoque?: number } }>("/dashboard", {
    token,
  });
  ok(`dashboard OK (alertasEstoque=${dash.kpis?.alertasEstoque ?? "?"})`);

  if (tbo) {
    const transf = await req<{
      fluxo: string;
      creditoDestino: string;
      transferencia: {
        id: string;
        status: string;
        itens: Array<{ id: string; produtoId: string }>;
      };
    }>("/movimentacoes", {
      method: "POST",
      token,
      body: {
        tipoId: tipoTransf.id,
        filialId: pln.id,
        filialDestinoId: tbo.id,
        produtoId: produto.id,
        quantidade: 8,
        creditoDestino: "AGUARDAR_RECEBIMENTO",
        observacao: "SMOKE-F10",
      },
      expectStatus: 201,
    });
    if (
      transf.fluxo !== "TRANSFERENCIA" ||
      transf.transferencia.status !== "EM_TRANSITO"
    ) {
      fail("Transferência deveria ficar EM_TRANSITO via Novo Lançamento", transf);
    }
    ok(`transferência enviada ${transf.transferencia.id.slice(0, 8)}… (F15)`);

    const item = transf.transferencia.itens[0];
    if (!item) fail("Transferência sem itens");

    const conf = await req<{
      transferencia: { status: string };
      temDivergencia: boolean;
    }>(`/transferencias/${transf.transferencia.id}/conferir`, {
      method: "POST",
      token,
      body: {
        itens: [{ itemId: item.id, qtdRecebida: 8 }],
      },
    });
    if (conf.transferencia.status !== "RECEBIDO" || conf.temDivergencia) {
      fail("Conferência deveria ser RECEBIDO sem divergência", conf);
    }
    ok("transferência conferida RECEBIDO (PLN→TBO)");

    const estoquesTbo = await req<{
      data: Array<{ produtoId: string; saldoAtual: string | number }>;
    }>(`/estoques?filialId=${tbo.id}&limit=500`, { token });
    const rowTbo = estoquesTbo.data.find((e) => e.produtoId === produto.id);
    const saldoTbo = rowTbo ? Number(rowTbo.saldoAtual) : NaN;
    if (saldoTbo !== 8) {
      fail(`Saldo TBO esperado 8, obtido ${saldoTbo}`, rowTbo);
    }
    ok(`saldo TBO conferido = ${saldoTbo}`);
  } else {
    console.log("⚠ TBO ausente — pulando smoke de transferência (Go-Live A)");
  }

  console.log(`\nF10 smoke OK (${step} checks)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
