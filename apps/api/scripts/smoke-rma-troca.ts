/**
 * Smoke RMA — fluxo por item: laudo → notificar → aprovar → manutenção → troca
 *
 * Pré: API no ar, migrate + seed (SEED_DEMO=1 recomendado).
 * Uso: pnpm exec tsx scripts/smoke-rma-troca.ts
 */
import "dotenv/config";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const API = process.env.API_URL || "http://localhost:4000";
const EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@teep.com.br";
const SENHA = process.env.SEED_ADMIN_PASSWORD || "Admin@123";

/** PDF mínimo válido para upload de laudo */
const MIN_PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  "utf8"
);

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
  if (!okStatus) {
    fail(`${opts.method || "GET"} ${pathName} → ${res.status}`, data);
  }
  return data as T;
}

async function uploadLaudo(token: string): Promise<string> {
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([MIN_PDF], { type: "application/pdf" }),
    "smoke-laudo.pdf"
  );
  fd.append("context", "rma");
  fd.append("kind", "laudo");
  const res = await fetch(`${API}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const data = (await res.json()) as { url?: string };
  if (!res.ok || !data.url) fail("upload laudo falhou", data);
  return data.url;
}

async function main() {
  console.log(`\nRMA troca smoke (etapas por item) → ${API}\n`);

  await req("/health");
  ok("health");

  const login = await req<{ accessToken: string; user: { id: string } }>(
    "/auth/login",
    {
      method: "POST",
      body: { email: EMAIL, senha: SENHA },
    }
  );
  const token = login.accessToken;
  const comercialId = login.user?.id;
  if (!token) fail("login sem accessToken");
  if (!comercialId) fail("login sem user.id");
  ok("login admin");
  ok(`comercial ${comercialId.slice(0, 8)}`);

  const filiais = await req<
    Array<{ id: string; sigla: string; nome: string }>
  >("/filiais", { token });
  const pln = filiais.find((f) => f.sigla === "PLN");
  const rma = filiais.find((f) => f.sigla === "RMA");
  const desc = filiais.find((f) => f.sigla === "DESC");
  if (!pln || !rma || !desc) {
    fail("Filiais PLN/RMA/DESC não encontradas — rode db:seed", filiais);
  }
  ok(`filiais ${pln!.sigla}/${rma!.sigla}/${desc!.sigla}`);

  const clientes = await req<Array<{ id: string; nome: string }>>("/clientes", {
    token,
  });
  let clienteId = clientes[0]?.id;
  if (!clienteId) {
    const c = await req<{ id: string }>("/clientes", {
      method: "POST",
      token,
      body: {
        nome: "Cliente Smoke RMA",
        tipo: "CLIENTE",
        documento: null,
      },
      expectStatus: 201,
    });
    clienteId = c.id;
  }
  ok(`cliente ${clienteId}`);

  const cats = await req<Array<{ id: string }>>("/categorias", { token });
  if (!cats.length) fail("Sem categorias — rode seed");
  const suf = Date.now().toString(36).slice(-6).toUpperCase();
  const prod = await req<{ id: string; codigo: string }>("/produtos", {
    method: "POST",
    token,
    body: {
      codigo: `SMK${suf}`,
      descricao: `Produto smoke RMA ${suf}`,
      categoriaId: cats[0].id,
      unidade: "UN",
      controlaSerie: true,
      estoqueMinimo: 0,
      estoqueMaximo: 0,
    },
    expectStatus: 201,
  });
  ok(`produto ${prod.codigo} (controlaSerie)`);

  const tipos = await req<
    Array<{ id: string; nome: string; operacao: string }>
  >("/tipos-movimentacao", { token });
  const tipoCompra = tipos.find((t) => t.nome === "Compra");
  if (!tipoCompra) fail("Tipo Compra não encontrado — rode db:seed", tipos);

  const snRuim = `RUIM-${suf}-001`;
  const snBoa = `BOA-${suf}-001`;

  await req("/movimentacoes", {
    method: "POST",
    token,
    body: {
      tipoId: tipoCompra.id,
      produtoId: prod.id,
      filialId: pln!.id,
      clienteId,
      quantidade: 1,
      series: [snBoa],
      observacao: "Smoke RMA — peça boa em PLN",
    },
  });
  ok(`peça boa ${snBoa} em PLN`);

  const processo = await req<{
    id: string;
    status: string;
    itens: Array<{
      id: string;
      status: string;
      etapa?: string;
      unidadeSerie?: { numeroSerie: string };
    }>;
  }>("/rma", {
    method: "POST",
    token,
    body: {
      clienteId,
      responsavelComercialId: comercialId,
      itens: [{ produtoId: prod.id, series: [snRuim] }],
    },
    expectStatus: 201,
  });
  const itemId = processo.itens[0]?.id;
  if (!itemId) fail("RMA sem item", processo);
  if (processo.itens[0].status !== "EM_ESTOQUE") {
    fail(
      `item status esperado EM_ESTOQUE, veio ${processo.itens[0].status}`,
      processo.itens[0]
    );
  }
  if ((processo.itens[0].etapa || "") !== "AGUARDANDO_LAUDO") {
    fail(
      `etapa esperada AGUARDANDO_LAUDO, veio ${processo.itens[0].etapa}`,
      processo.itens[0]
    );
  }
  ok(`RMA aberto ${processo.id.slice(0, 8)} — ${snRuim} AGUARDANDO_LAUDO`);

  const laudoUrl = await uploadLaudo(token);
  await req(`/rma/${processo.id}/anexos`, {
    method: "POST",
    token,
    body: {
      tipo: "LAUDO",
      arquivo: laudoUrl,
      label: "smoke-laudo.pdf",
      itemId,
    },
  });
  ok("laudo anexado");

  await req(`/rma/${processo.id}/notificar-laudos`, {
    method: "POST",
    token,
  });
  ok("laudos notificados");

  const aposNotify = await req<{
    itens: Array<{ id: string; etapa?: string }>;
  }>(`/rma/${processo.id}`, { token });
  const etNotify = aposNotify.itens.find((i) => i.id === itemId)?.etapa;
  if (etNotify !== "AGUARDANDO_APROVACAO") {
    fail(`esperado AGUARDANDO_APROVACAO, veio ${etNotify}`, aposNotify.itens);
  }
  ok("etapa AGUARDANDO_APROVACAO");

  await req(`/rma/${processo.id}/itens/${itemId}/aprovacao`, {
    method: "POST",
    token,
    body: { decisao: "APROVADA", observacao: "Smoke: aprovação item" },
  });
  ok("item APROVADO → AGUARDANDO_MANUTENCAO");

  await req(`/rma/${processo.id}/itens/${itemId}/manutencao-realizada`, {
    method: "POST",
    token,
  });
  ok("manutenção realizada → AGUARDANDO_ENVIO");

  const aposTroca = await req<{
    status: string;
    itens: Array<{
      id: string;
      status: string;
      etapa?: string;
      movSaidaId?: string | null;
      movDescarteId?: string | null;
      unidadeSerie?: { numeroSerie: string } | null;
      unidadeSerieSubstituicao?: { numeroSerie: string } | null;
    }>;
  }>(`/rma/${processo.id}/trocar`, {
    method: "POST",
    token,
    body: {
      itemId,
      origemFilialId: pln!.id,
      numeroSerieBoa: snBoa,
      destinoDescarteFilialId: desc!.id,
      observacao: "Smoke: trocado por peça boa",
    },
  });
  const item = aposTroca.itens.find((i) => i.id === itemId);
  if (!item) fail("item sumiu após troca", aposTroca);
  if (item!.status !== "DESCARTADO") {
    fail(`esperado DESCARTADO, veio ${item!.status}`, item);
  }
  if (item!.etapa !== "FINALIZADO") {
    fail(`esperado FINALIZADO, veio ${item!.etapa}`, item);
  }
  if (!item!.movSaidaId || !item!.movDescarteId) {
    fail("movSaidaId/movDescarteId ausentes", item);
  }
  if (item!.unidadeSerieSubstituicao?.numeroSerie?.toUpperCase() !== snBoa) {
    fail("série substituta não batida", item);
  }
  ok(
    `troca OK — ruim ${item!.unidadeSerie?.numeroSerie} → DESC; boa ${snBoa} ao cliente`
  );

  const serieBoa = await req<{
    data: Array<{
      numeroSerie: string;
      status: string;
      filial?: { sigla: string };
    }>;
  }>(`/series?q=${encodeURIComponent(snBoa)}`, { token });
  const boaRow = serieBoa.data?.find(
    (s) => s.numeroSerie.toUpperCase() === snBoa
  );
  if (!boaRow || boaRow.status !== "SAIDO") {
    fail(`série boa deveria estar SAIDO`, boaRow || serieBoa);
  }
  ok(`série boa SAIDO`);

  const serieRuim = await req<{
    data: Array<{
      numeroSerie: string;
      status: string;
      filial?: { sigla: string } | null;
    }>;
  }>(`/series?q=${encodeURIComponent(snRuim)}`, { token });
  const ruimRow = serieRuim.data?.find(
    (s) => s.numeroSerie.toUpperCase() === snRuim
  );
  if (!ruimRow || ruimRow.status !== "EM_ESTOQUE") {
    fail(`série ruim deveria estar EM_ESTOQUE no DESC`, ruimRow || serieRuim);
  }
  if (ruimRow!.filial?.sigla !== "DESC") {
    fail(`série ruim deveria estar na filial DESC`, ruimRow);
  }
  ok(`série ruim EM_ESTOQUE em DESC`);

  if (aposTroca.status !== "FECHADO") {
    fail(`processo esperado FECHADO, veio ${aposTroca.status}`, aposTroca);
  }
  ok("processo FECHADO");

  console.log("\n✅ Smoke RMA troca (por item) passou.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
