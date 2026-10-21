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

import { cnpjFromRaiz } from "@teep/shared";

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

async function uploadRmaPdf(token: string, filename: string): Promise<string> {
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([MIN_PDF], { type: "application/pdf" }),
    filename
  );
  fd.append("context", "rma");
  fd.append("kind", "nf");
  const res = await fetch(`${API}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const data = (await res.json()) as { url?: string };
  if (!res.ok || !data.url) fail("upload NF RMA falhou", data);
  return data.url;
}

type TipoMov = {
  id: string;
  nome: string;
  operacao: string;
  rmaEntradaEstoque?: boolean;
  rmaSaidaCliente?: boolean;
};

async function ensureRmaTipos(token: string, suf: string) {
  const tipos = await req<TipoMov[]>("/tipos-movimentacao", { token });
  if (!tipos.some((t) => t.rmaEntradaEstoque)) {
    await req("/tipos-movimentacao", {
      method: "POST",
      token,
      body: {
        codigo: `RMA-ENT-${suf}`.slice(0, 30),
        nome: `Smoke entrada RMA ${suf}`,
        operacao: "ENTRADA",
        requerCliente: true,
        requerAprovacao: false,
        permitidoOperador: true,
        permitidoGerente: true,
        rmaEntradaEstoque: true,
      },
      expectStatus: 201,
    });
    ok("tipo ENTRADA com flag RMA cadastrado");
  }
  if (!tipos.some((t) => t.rmaSaidaCliente)) {
    await req("/tipos-movimentacao", {
      method: "POST",
      token,
      body: {
        codigo: `RMA-SAI-${suf}`.slice(0, 30),
        nome: `Smoke saída RMA ${suf}`,
        operacao: "SAIDA",
        requerCliente: true,
        requerAprovacao: false,
        permitidoOperador: true,
        permitidoGerente: true,
        rmaSaidaCliente: true,
      },
      expectStatus: 201,
    });
    ok("tipo SAÍDA com flag RMA cadastrado");
  }
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
        documento: cnpjFromRaiz(`4${String(Date.now()).slice(-7)}`),
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

  await ensureRmaTipos(token, suf);

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
      nfEntradaNumero: "SMOKE-NF-ENT",
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
  if ((processo.itens[0].etapa || "") !== "AGUARDANDO_RECEBIMENTO") {
    fail(
      `etapa esperada AGUARDANDO_RECEBIMENTO, veio ${processo.itens[0].etapa}`,
      processo.itens[0]
    );
  }
  ok(`RMA aberto ${processo.id.slice(0, 8)} — ${snRuim} AGUARDANDO_RECEBIMENTO`);

  const produtoId = prod.id;
  await req(`/rma/checklists`, {
    method: "PUT",
    token,
    body: {
      produtoId,
      tipo: "RECEBIMENTO",
      nome: "Smoke recebimento",
      itens: [
        {
          codigo: "1",
          titulo: "Inspeção visual OK?",
          tipoCampo: "SIM_NAO",
          obrigatorio: true,
          ordem: 0,
        },
      ],
    },
  });
  await req(`/rma/checklists`, {
    method: "PUT",
    token,
    body: {
      produtoId,
      tipo: "LIBERACAO",
      nome: "Smoke liberação",
      itens: [
        {
          codigo: "1",
          titulo: "Pronto para envio?",
          tipoCampo: "SIM_NAO",
          obrigatorio: true,
          ordem: 0,
        },
      ],
    },
  });
  ok("templates checklist");

  await req(`/rma/${processo.id}/itens/${itemId}/checklist/RECEBIMENTO/iniciar`, {
    method: "POST",
    token,
  });
  const comCheck = await req<{
    itens: Array<{
      id: string;
      checklistExecucoes?: Array<{
        tipo: string;
        template: { itens: Array<{ id: string }> };
      }>;
    }>;
  }>(`/rma/${processo.id}`, { token });
  const recv = comCheck.itens
    .find((i) => i.id === itemId)
    ?.checklistExecucoes?.find((e) => e.tipo === "RECEBIMENTO");
  const tiId = recv?.template.itens[0]?.id;
  if (!tiId) fail("checklist recebimento sem item", recv);

  await req(
    `/rma/${processo.id}/itens/${itemId}/checklist/RECEBIMENTO/concluir`,
    {
      method: "POST",
      token,
      body: {
        respostas: [{ templateItemId: tiId, valorBool: true, fotos: [] }],
      },
    }
  );
  ok("checklist recebimento");

  await req(
    `/rma/${processo.id}/itens/${itemId}/diagnostico-plano/concluir`,
    {
      method: "POST",
      token,
      body: {
        resumoProblema: "Smoke: defeito simulado",
        servicos: [{ descricao: "Revisão geral", ordem: 0 }],
        pecas: [],
      },
    }
  );
  ok("plano → AGUARDANDO_ORCAMENTO");

  await req(`/rma/${processo.id}/itens/${itemId}/orcamento`, {
    method: "PUT",
    token,
    body: {
      maoDeObra: 10,
      desconto: 0,
      linhas: [
        {
          descricao: "Revisão geral",
          quantidade: 1,
          valorUnitario: 50,
          origem: "SERVICO",
        },
      ],
    },
  });
  await req(`/rma/${processo.id}/itens/${itemId}/orcamento/enviar`, {
    method: "POST",
    token,
  });
  await req(`/rma/${processo.id}/itens/${itemId}/orcamento/aprovar`, {
    method: "POST",
    token,
    body: { observacao: "Smoke: cliente aprovou" },
  });
  ok("orçamento aprovado → AGUARDANDO_MANUTENCAO");

  await req(`/rma/${processo.id}/itens/${itemId}/manutencao-realizada`, {
    method: "POST",
    token,
  });
  ok("manutenção realizada → AGUARDANDO_LIBERACAO");

  await req(`/rma/${processo.id}/itens/${itemId}/checklist/LIBERACAO/iniciar`, {
    method: "POST",
    token,
  });
  const comLib = await req<{
    itens: Array<{
      id: string;
      checklistExecucoes?: Array<{
        tipo: string;
        template: { itens: Array<{ id: string }> };
      }>;
    }>;
  }>(`/rma/${processo.id}`, { token });
  const lib = comLib.itens
    .find((i) => i.id === itemId)
    ?.checklistExecucoes?.find((e) => e.tipo === "LIBERACAO");
  const libTi = lib?.template.itens[0]?.id;
  if (!libTi) fail("checklist liberação sem item", lib);

  const nfRetUrl = await uploadRmaPdf(token, "smoke-nf-retorno.pdf");
  await req(`/rma/${processo.id}/anexos`, {
    method: "POST",
    token,
    body: { tipo: "NF_SAIDA", arquivo: nfRetUrl },
  });
  await req(`/rma/${processo.id}/financeiro`, {
    method: "PATCH",
    token,
    body: { nfSaidaNumero: "SMOKE-NF-RET" },
  });
  ok("NF de retorno informada (número + arquivo)");

  await req(
    `/rma/${processo.id}/itens/${itemId}/checklist/LIBERACAO/concluir`,
    {
      method: "POST",
      token,
      body: {
        respostas: [{ templateItemId: libTi, valorBool: true, fotos: [] }],
      },
    }
  );
  ok("liberação → AGUARDANDO_ENVIO");

  await req(`/rma/${processo.id}/trocar`, {
    method: "POST",
    token,
    body: {
      itemId,
      origemFilialId: pln!.id,
      numeroSerieBoa: snBoa,
      nfSaidaNumero: "SMOKE-NF-RET",
      substituicaoAutorizadaPorId: comercialId,
      observacao: "Smoke: troca indevida em envio",
    },
    expectStatus: 400,
  });
  ok("troca recusada em aguardando envio");

  const aposVolta = await req<{
    itens: Array<{ id: string; etapa?: string; status: string }>;
  }>(`/rma/${processo.id}/itens/${itemId}/voltar-manutencao`, {
    method: "POST",
    token,
  });
  const itemVolta = aposVolta.itens.find((i) => i.id === itemId);
  if (itemVolta?.etapa !== "AGUARDANDO_MANUTENCAO") {
    fail(
      `esperado AGUARDANDO_MANUTENCAO após voltar, veio ${itemVolta?.etapa}`,
      itemVolta
    );
  }
  ok("voltar manutenção → AGUARDANDO_MANUTENCAO");

  await req(`/rma/${processo.id}/itens/${itemId}/manutencao-realizada`, {
    method: "POST",
    token,
  });
  ok("manutenção realizada de novo → AGUARDANDO_LIBERACAO (troca permitida)");

  const aposTroca = await req<{
    status: string;
    filial?: { sigla: string };
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
      substituicaoAutorizadaPorId: comercialId,
      observacao: "Smoke: trocado por peça boa",
    },
  });
  const item = aposTroca.itens.find((i) => i.id === itemId);
  if (!item) fail("item sumiu após troca", aposTroca);
  if (item!.status !== "EM_ESTOQUE" && item!.status !== "SEM_MANUTENCAO") {
    fail(`esperado ainda no RMA, veio ${item!.status}`, item);
  }
  if (item!.etapa !== "AGUARDANDO_ENVIO") {
    fail(`esperado AGUARDANDO_ENVIO, veio ${item!.etapa}`, item);
  }
  if (item!.movSaidaId) {
    fail("troca não deve dar baixa ao cliente", item);
  }
  if (item!.movDescarteId) {
    fail("troca não deve mover a série original para descarte", item);
  }
  if (item!.unidadeSerieSubstituicao?.numeroSerie?.toUpperCase() !== snBoa) {
    fail("série substituta não batida", item);
  }
  ok(
    `troca OK — boa ${snBoa} amarrada ao RMA; original ${item!.unidadeSerie?.numeroSerie} permanece no estoque RMA`
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
  if (!boaRow || boaRow.status !== "EM_ESTOQUE") {
    fail(`série boa deveria estar EM_ESTOQUE no RMA`, boaRow || serieBoa);
  }
  if (boaRow!.filial?.sigla !== "RMA") {
    fail(`série boa deveria estar na filial RMA`, boaRow);
  }
  ok(`série boa EM_ESTOQUE no RMA (${boaRow!.filial?.sigla || "?"})`);

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
    fail(`série original deveria permanecer EM_ESTOQUE no RMA`, ruimRow || serieRuim);
  }
  if (ruimRow!.filial?.sigla !== "RMA") {
    fail(`série original deveria permanecer na filial RMA`, ruimRow);
  }
  ok(`série original EM_ESTOQUE em RMA`);

  if (aposTroca.status !== "ABERTO") {
    fail(`processo esperado ABERTO após troca, veio ${aposTroca.status}`, aposTroca);
  }

  const aposDevolver = await req<{
    status: string;
    itens: Array<{ id: string; status: string; etapa?: string }>;
  }>(`/rma/${processo.id}/devolver`, {
    method: "POST",
    token,
    body: {
      itemIds: [itemId],
      nfSaidaNumero: "SMOKE-NF-RET",
    },
  });
  const itemDev = aposDevolver.itens.find((i) => i.id === itemId);
  if (itemDev?.status !== "DEVOLVIDO") {
    fail(`esperado DEVOLVIDO, veio ${itemDev?.status}`, itemDev);
  }
  ok("devolver após troca → baixa da peça boa ao cliente");

  const boaDepois = await req<{
    data: Array<{ numeroSerie: string; status: string }>;
  }>(`/series?q=${encodeURIComponent(snBoa)}`, { token });
  const boaOut = boaDepois.data?.find(
    (s) => s.numeroSerie.toUpperCase() === snBoa
  );
  if (!boaOut || boaOut.status !== "SAIDO") {
    fail(`série boa deveria estar SAIDO após devolver`, boaOut || boaDepois);
  }
  ok("série boa SAIDO após devolver");

  if (aposDevolver.status !== "FECHADO") {
    fail(
      `processo esperado FECHADO após devolver, veio ${aposDevolver.status}`,
      aposDevolver
    );
  }
  ok("processo FECHADO após devolver");

  console.log("\n✅ Smoke RMA troca (por item) passou.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
