/**
 * Smoke — baixa por árvore (SAIDA + TRANSFERENCIA)
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

async function saldo(
  token: string,
  produtoId: string,
  filialId: string
): Promise<number> {
  const r = await req<{ saldoAtual: number | string }>(
    `/estoques/saldo?produtoId=${produtoId}&filialId=${filialId}`,
    { token }
  );
  return Number(r.saldoAtual);
}

async function main() {
  console.log(`\nBaixa por árvore smoke → ${API}\n`);

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
  if (!pln || !tbo) fail("PLN/TBO ausentes");

  const cats = await req<Array<{ id: string }>>("/categorias", { token });
  const tipos = await req<
    Array<{
      id: string;
      nome: string;
      operacao: string;
      baixaPorArvore?: boolean;
    }>
  >("/tipos-movimentacao", { token });
  let tipoArvore = tipos.find(
    (t) =>
      (t.nome === "Saída com árvore" || t.nome === "Montagem / Produção") &&
      t.baixaPorArvore
  );
  const tipoCompra = tipos.find((t) => t.nome === "Compra");
  const tipoTransf = tipos.find(
    (t) => t.operacao === "TRANSFERENCIA" && !t.nome.includes("Enviada")
  );
  if (!tipoCompra || !cats[0]) {
    fail("tipos seed incompletos (rode db:seed)", { tipoArvore, tipoCompra });
  }
  if (!tipoArvore || tipoArvore.operacao !== "SAIDA") {
    // Atualiza tipo legado ENTRADA → SAIDA com árvore
    if (tipoArvore) {
      await req(`/tipos-movimentacao/${tipoArvore.id}`, {
        method: "PATCH",
        token,
        body: { baixaPorArvore: false },
      });
    }
    const created = await req<{ id: string; operacao: string }>(
      "/tipos-movimentacao",
      {
        method: "POST",
        token,
        body: {
          nome: `Saída Árvore ${Date.now().toString(36).slice(-4)}`,
          operacao: "SAIDA",
          requerCliente: false,
          requerAprovacao: false,
          baixaPorArvore: true,
          permitidoOperador: true,
          permitidoGerente: true,
        },
        expectStatus: 201,
      }
    );
    tipoArvore = {
      id: created.id,
      nome: "Saída Árvore smoke",
      operacao: "SAIDA",
      baixaPorArvore: true,
    };
  }

  // Garante um tipo TRANSFERENCIA com árvore
  let tipoTransfArvore = tipos.find(
    (t) => t.operacao === "TRANSFERENCIA" && t.baixaPorArvore
  );
  if (!tipoTransfArvore) {
    if (!tipoTransf) fail("tipo TRANSFERENCIA ausente no seed");
    const created = await req<{ id: string }>(
      "/tipos-movimentacao",
      {
        method: "POST",
        token,
        body: {
          nome: `Transf Árvore ${Date.now().toString(36).slice(-4)}`,
          operacao: "TRANSFERENCIA",
          requerCliente: false,
          requerAprovacao: false,
          baixaPorArvore: true,
          permitidoOperador: true,
          permitidoGerente: true,
        },
        expectStatus: 201,
      }
    );
    tipoTransfArvore = {
      id: created.id,
      nome: "Transf Árvore",
      operacao: "TRANSFERENCIA",
      baixaPorArvore: true,
    };
  }

  const clientes = await req<Array<{ id: string }>>("/clientes", { token });
  let clienteId = clientes[0]?.id;
  if (!clienteId) {
    const c = await req<{ id: string }>("/clientes", {
      method: "POST",
      token,
      body: { nome: "Forn Smoke BOM", tipo: "FORNECEDOR", documento: null },
      expectStatus: 201,
    });
    clienteId = c.id;
  }

  const suf = Date.now().toString(36).slice(-5).toUpperCase();
  const mkProd = async (codigo: string, desc: string) =>
    req<{ id: string; codigo: string }>("/produtos", {
      method: "POST",
      token,
      body: {
        codigo,
        descricao: desc,
        categoriaId: cats[0].id,
        unidade: "UN",
        controlaSerie: false,
      },
      expectStatus: 201,
    });

  const acabado = await mkProd(`AC${suf}`, `Acabado ${suf}`);
  const gab = await mkProd(`GB${suf}`, `Gabinete ${suf}`);
  const placa = await mkProd(`PL${suf}`, `Placa ${suf}`);
  const fant = await mkProd(`FT${suf}`, `Fantasma ${suf}`);
  ok(`produtos ${acabado.codigo} + 3 componentes`);

  await req(`/produtos/${acabado.id}/componentes`, {
    method: "PUT",
    token,
    body: {
      itens: [
        { produtoFilhoId: gab.id, quantidade: 1, fantasma: false },
        { produtoFilhoId: placa.id, quantidade: 2, fantasma: false },
        { produtoFilhoId: fant.id, quantidade: 1, fantasma: true },
      ],
    },
  });
  ok("BOM salva (2 baixam + 1 fantasma)");

  // Abastece componentes em PLN
  for (const p of [gab, placa, fant]) {
    await req("/movimentacoes", {
      method: "POST",
      token,
      body: {
        tipoId: tipoCompra!.id,
        produtoId: p.id,
        filialId: pln!.id,
        clienteId,
        quantidade: 20,
        observacao: "Smoke BOM abastece origem",
      },
    });
  }
  ok("componentes abastecidos em PLN");

  const sGab0 = await saldo(token, gab.id, pln!.id);
  const sPlaca0 = await saldo(token, placa.id, pln!.id);
  const sFant0 = await saldo(token, fant.id, pln!.id);
  const sAcab0 = await saldo(token, acabado.id, pln!.id);

  // SAIDA com árvore: baixa componentes, não mexe saldo do pai
  const mov = await req<{ movimentacao: { id: string } }>("/movimentacoes", {
    method: "POST",
    token,
    body: {
      tipoId: tipoArvore!.id,
      produtoId: acabado.id,
      filialId: pln!.id,
      quantidade: 3,
      observacao: "Smoke saída árvore",
    },
  });
  ok(`saída árvore ${mov.movimentacao?.id?.slice(0, 8)}`);

  const sGab1 = await saldo(token, gab.id, pln!.id);
  const sPlaca1 = await saldo(token, placa.id, pln!.id);
  const sFant1 = await saldo(token, fant.id, pln!.id);
  const sAcab1 = await saldo(token, acabado.id, pln!.id);

  if (Math.abs(sAcab1 - sAcab0) > 1e-6) fail("pai não deveria baixar na SAIDA árvore", { sAcab0, sAcab1 });
  if (Math.abs(sGab1 - (sGab0 - 3)) > 1e-6) fail("gabinete não baixou 3", { sGab0, sGab1 });
  if (Math.abs(sPlaca1 - (sPlaca0 - 6)) > 1e-6) fail("placa não baixou 6", { sPlaca0, sPlaca1 });
  if (Math.abs(sFant1 - sFant0) > 1e-6) fail("fantasma não deveria baixar", { sFant0, sFant1 });
  ok("saldos SAIDA OK (fantasma intacto, pai intacto)");

  // Estorno devolve componentes
  await req(`/movimentacoes/${mov.movimentacao.id}/estornar`, {
    method: "POST",
    token,
    body: { observacao: "Smoke estorno árvore" },
  });
  const sGab2 = await saldo(token, gab.id, pln!.id);
  if (Math.abs(sGab2 - sGab0) > 1e-6) fail("estorno não devolveu gabinete", { sGab0, sGab2 });
  ok("estorno devolveu componentes");

  // TRANSFERENCIA com árvore: baixa BOM em PLN, entra pai em TBO
  const sGab3 = await saldo(token, gab.id, pln!.id);
  const sAcabTbo0 = await saldo(token, acabado.id, tbo!.id);

  const transf = await req<{
    transferencia?: { id: string };
    fluxo?: string;
  }>("/movimentacoes", {
    method: "POST",
    token,
    body: {
      tipoId: tipoTransfArvore!.id,
      produtoId: acabado.id,
      filialId: pln!.id,
      filialDestinoId: tbo!.id,
      quantidade: 2,
      creditoDestino: "IMEDIATO",
      observacao: "Smoke transf árvore",
    },
  });
  ok(`transferência árvore ${transf.transferencia?.id?.slice(0, 8) || "ok"}`);

  const sGab4 = await saldo(token, gab.id, pln!.id);
  const sPlaca4 = await saldo(token, placa.id, pln!.id);
  const sAcabTbo1 = await saldo(token, acabado.id, tbo!.id);
  const sAcabPln = await saldo(token, acabado.id, pln!.id);

  if (Math.abs(sGab4 - (sGab3 - 2)) > 1e-6) fail("transf não baixou gabinete", { sGab3, sGab4 });
  if (Math.abs(sPlaca4 - (sPlaca0 - 4)) > 1e-6) {
    fail("transf não baixou placa 4", { sPlaca0, sPlaca4 });
  }
  if (Math.abs(sAcabTbo1 - (sAcabTbo0 + 2)) > 1e-6) {
    fail("pai não entrou no destino", { sAcabTbo0, sAcabTbo1 });
  }
  if (Math.abs(sAcabPln - sAcab0) > 1e-6) {
    fail("pai não deveria sair da origem", { sAcab0, sAcabPln });
  }
  ok("transferência: árvore baixa na origem, item único no destino");

  console.log("\n✅ Smoke baixa por árvore passou.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
