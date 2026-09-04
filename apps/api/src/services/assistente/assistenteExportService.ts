import ExcelJS from "exceljs";
import { BRAND_COLOR } from "@teep/shared";
import { AuthUser } from "../../middleware/auth";
import { AppError } from "../../middleware/error";
import { prisma } from "../../lib/prisma";
import { htmlToPdf } from "../../lib/pdf";
import { brandAssetBuffer, brandAssetDataUri } from "../../lib/brandAssets";
import { relacionamentosDoProduto } from "../parceiroHistoricoService";
import { dateStampSaoPaulo } from "../saldosExportService";
import type { AssistenteExportFormat } from "./assistenteExportTokenStore";

export type DossieSaldo = {
  filialSigla: string;
  filialNome: string;
  qty: number;
  valorEstoque: number;
};

export type DossieParceiro = {
  nome: string;
  tipo: string;
  quantidadeTotal: number;
  ultimaData: string;
  movimentos: number;
};

export type DossieProduto = {
  produto: {
    codigo: string;
    descricao: string;
    unidade: string;
    precoUnitario: number;
    categoria: string;
  };
  saldos: DossieSaldo[];
  qtyTotal: number;
  valorTotal: number;
  fornecedores: DossieParceiro[];
  clientes: DossieParceiro[];
  geradoEm: string;
  usuario: string;
  perfil: string;
  escopo: string;
};

function moneyBr(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function qtyBr(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stampSaoPaulo() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
}

function formatUltimaData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
  }).format(d);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveFilialId(
  user: AuthUser,
  requested?: string | null,
  hint?: string | null
): string | null {
  if (user.perfil === "OPERADOR") {
    const ids =
      user.filialIds?.length > 0
        ? user.filialIds
        : user.filialId
          ? [user.filialId]
          : [];
    if (ids.length === 0) return null;
    const pick = requested || hint;
    if (pick && ids.includes(pick)) return pick;
    return user.filialId && ids.includes(user.filialId)
      ? user.filialId
      : ids[0]!;
  }
  const id = requested || hint || null;
  if (id && !UUID_RE.test(id)) {
    throw new AppError(400, "filialId inválido");
  }
  return id;
}

async function findProdutoByCodigoOuNome(codigoOuNome: string) {
  const q = codigoOuNome.trim();
  const select = {
    id: true,
    codigo: true,
    descricao: true,
    unidade: true,
    precoUnitario: true,
    categoria: { select: { nome: true } },
  } as const;

  const exact = await prisma.produto.findFirst({
    where: { ativo: true, codigo: { equals: q, mode: "insensitive" } },
    select,
  });
  if (exact) return exact;

  const contains = await prisma.produto.findFirst({
    where: {
      ativo: true,
      OR: [
        { codigo: { contains: q, mode: "insensitive" } },
        { descricao: { contains: q, mode: "insensitive" } },
      ],
    },
    select,
    orderBy: { codigo: "asc" },
  });
  if (contains) return contains;

  const tokens = q
    .split(/[\s,/._-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length < 2) return null;

  return prisma.produto.findFirst({
    where: {
      ativo: true,
      AND: tokens.map((t) => ({
        OR: [
          { codigo: { contains: t, mode: "insensitive" } },
          { descricao: { contains: t, mode: "insensitive" } },
        ],
      })),
    },
    select,
    orderBy: { codigo: "asc" },
  });
}

/** Carrega dossiê: produto + estoque + fornecedores + clientes. */
export async function carregarDossieProduto(
  user: AuthUser,
  codigoOuNome: string,
  opts: { filialId?: string | null; filialHint?: string | null } = {}
): Promise<DossieProduto> {
  const filialId = resolveFilialId(user, opts.filialId, opts.filialHint);
  if (filialId) {
    const f = await prisma.filial.findFirst({
      where: { id: filialId, ativo: true },
      select: { id: true, sigla: true },
    });
    if (!f) throw new AppError(404, "Filial não encontrada");
  }

  const produto = await findProdutoByCodigoOuNome(codigoOuNome);
  if (!produto) {
    throw new AppError(404, "Produto não encontrado no cadastro");
  }

  const preco = Number(produto.precoUnitario);
  const estoques = await prisma.estoque.findMany({
    where: {
      produtoId: produto.id,
      ...(filialId ? { filialId } : {}),
    },
    select: {
      saldoAtual: true,
      filial: { select: { sigla: true, nome: true } },
    },
    orderBy: { filial: { sigla: "asc" } },
  });

  const saldos: DossieSaldo[] = estoques.map((e) => {
    const qty = Number(e.saldoAtual);
    return {
      filialSigla: e.filial.sigla,
      filialNome: e.filial.nome,
      qty,
      valorEstoque: Math.round(qty * preco * 100) / 100,
    };
  });
  const qtyTotal = saldos.reduce((s, r) => s + r.qty, 0);
  const valorTotal = Math.round(qtyTotal * preco * 100) / 100;

  const rel = await relacionamentosDoProduto(produto.id);

  let escopo = "Consolidado (todas as filiais)";
  if (filialId) {
    const f = await prisma.filial.findUnique({
      where: { id: filialId },
      select: { sigla: true },
    });
    escopo = f ? `Filial ${f.sigla}` : "Filial filtrada";
  } else if (user.perfil === "OPERADOR") {
    escopo = "Filiais do operador";
  }

  return {
    produto: {
      codigo: produto.codigo,
      descricao: produto.descricao,
      unidade: produto.unidade,
      precoUnitario: preco,
      categoria: produto.categoria.nome,
    },
    saldos,
    qtyTotal,
    valorTotal,
    fornecedores: rel.fornecedores.map((p) => ({
      nome: p.nome,
      tipo: p.tipo,
      quantidadeTotal: p.quantidadeTotal,
      ultimaData: p.ultimaData,
      movimentos: p.movimentos,
    })),
    clientes: rel.clientes.map((p) => ({
      nome: p.nome,
      tipo: p.tipo,
      quantidadeTotal: p.quantidadeTotal,
      ultimaData: p.ultimaData,
      movimentos: p.movimentos,
    })),
    geradoEm: stampSaoPaulo(),
    usuario: user.nome,
    perfil: user.perfil,
    escopo,
  };
}

function buildDossieHtml(d: DossieProduto, incluirValor = true): string {
  const p = d.produto;
  const saldoRows =
    d.saldos.length === 0
      ? `<tr><td colspan="${incluirValor ? 4 : 3}" class="empty">Sem posição de estoque</td></tr>`
      : d.saldos
          .map(
            (s) => `<tr>
        <td>${escapeHtml(s.filialSigla)}</td>
        <td>${escapeHtml(s.filialNome)}</td>
        <td class="num">${qtyBr(s.qty)}</td>
        ${incluirValor ? `<td class="num">${moneyBr(s.valorEstoque)}</td>` : ""}
      </tr>`
          )
          .join("");

  const fornRows =
    d.fornecedores.length === 0
      ? `<tr><td colspan="4" class="empty">Nenhum fornecedor no histórico</td></tr>`
      : d.fornecedores
          .map(
            (f) => `<tr>
        <td>${escapeHtml(f.nome)}</td>
        <td>${escapeHtml(f.tipo)}</td>
        <td class="num">${qtyBr(f.quantidadeTotal)}</td>
        <td>${escapeHtml(formatUltimaData(f.ultimaData))}</td>
      </tr>`
          )
          .join("");

  const cliRows =
    d.clientes.length === 0
      ? `<tr><td colspan="4" class="empty">Nenhum cliente no histórico</td></tr>`
      : d.clientes
          .map(
            (c) => `<tr>
        <td>${escapeHtml(c.nome)}</td>
        <td>${escapeHtml(c.tipo)}</td>
        <td class="num">${qtyBr(c.quantidadeTotal)}</td>
        <td>${escapeHtml(formatUltimaData(c.ultimaData))}</td>
      </tr>`
          )
          .join("");

  const logoUri = brandAssetDataUri("logo-teep.png");
  const brandMark = logoUri
    ? `<img class="logo" src="${logoUri}" alt="TEEP" />`
    : `<div class="logo-fallback">TEEP Estoque</div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Dossiê ${escapeHtml(p.codigo)}</title>
<style>
  body { font-family: system-ui, Segoe UI, sans-serif; color: #0f172a; font-size: 11px; margin: 0; }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 3px solid ${BRAND_COLOR}; padding-bottom: 8px; margin-bottom: 12px; }
  .header-left { display: flex; align-items: center; gap: 12px; }
  .logo { height: 32px; width: auto; display: block; }
  .logo-fallback { color: ${BRAND_COLOR}; font-size: 18px; font-weight: 700; }
  h1 { color: #0f172a; font-size: 14px; margin: 0; }
  h2 { color: #334155; font-size: 13px; margin: 18px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .meta { color: #64748b; font-size: 10px; margin-bottom: 12px; }
  .kpis { display: flex; gap: 16px; margin: 10px 0 14px; }
  .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; min-width: 100px; }
  .kpi b { display: block; color: #64748b; font-size: 9px; font-weight: 600; text-transform: uppercase; }
  .kpi span { font-size: 14px; font-weight: 700; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th { background: ${BRAND_COLOR}; color: #fff; text-align: left; padding: 6px 8px; font-size: 10px; }
  td { border-bottom: 1px solid #e2e8f0; padding: 5px 8px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.empty { color: #94a3b8; font-style: italic; text-align: center; }
  .foot { color: #94a3b8; font-size: 9px; margin-top: 16px; }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      ${brandMark}
      <div>
        <h1>Relatório do Produto</h1>
        <div style="font-size:9px;color:#64748b;margin-top:2px;">TEEP Estoque</div>
      </div>
    </div>
  </div>
  <div class="meta">
    Gerado em ${escapeHtml(d.geradoEm)} · ${escapeHtml(d.usuario)} (${escapeHtml(d.perfil)}) · ${escapeHtml(d.escopo)}
  </div>
  <p><strong>${escapeHtml(p.codigo)}</strong> — ${escapeHtml(p.descricao)}<br/>
  Unidade: ${escapeHtml(p.unidade)} · Categoria: ${escapeHtml(p.categoria)}${
    incluirValor ? ` · Preço: ${moneyBr(p.precoUnitario)}` : ""
  }</p>

  <div class="kpis">
    <div class="kpi"><b>Qtd. total</b><span>${qtyBr(d.qtyTotal)}</span></div>
    ${
      incluirValor
        ? `<div class="kpi"><b>Valor estoque</b><span>${moneyBr(d.valorTotal)}</span></div>`
        : ""
    }
    <div class="kpi"><b>Fornecedores</b><span>${d.fornecedores.length}</span></div>
    <div class="kpi"><b>Clientes</b><span>${d.clientes.length}</span></div>
  </div>

  <h2>Estoque por filial</h2>
  <table>
    <thead><tr><th>Sigla</th><th>Filial</th><th>Saldo</th>${
      incluirValor ? "<th>Valor</th>" : ""
    }</tr></thead>
    <tbody>${saldoRows}</tbody>
  </table>

  <h2>Fornecedores (compras)</h2>
  <table>
    <thead><tr><th>Nome</th><th>Tipo</th><th>Qtd. comprada</th><th>Última compra</th></tr></thead>
    <tbody>${fornRows}</tbody>
  </table>

  <h2>Clientes (vendas/entregas)</h2>
  <table>
    <thead><tr><th>Nome</th><th>Tipo</th><th>Qtd. vendida</th><th>Última venda</th></tr></thead>
    <tbody>${cliRows}</tbody>
  </table>

  <div class="foot">Fornecedores = ENTRADA de compra; clientes = SAÍDA de venda/entrega. Ignora estornos e devoluções.${
    incluirValor ? " Valor = saldo × preço cadastrado." : ""
  }</div>
</body>
</html>`;
}

function safeFilenamePart(codigo: string): string {
  return codigo.replace(/[^\w.-]+/g, "_").slice(0, 40) || "produto";
}

export async function exportarDossieProdutoPdf(
  user: AuthUser,
  codigoOuNome: string,
  opts: {
    filialId?: string | null;
    filialHint?: string | null;
    incluirValor?: boolean;
  } = {}
): Promise<{ buffer: Buffer; filename: string; dossie: DossieProduto }> {
  const incluirValor = opts.incluirValor !== false;
  const dossie = await carregarDossieProduto(user, codigoOuNome, opts);
  const buffer = await htmlToPdf(buildDossieHtml(dossie, incluirValor));
  return {
    buffer,
    filename: `teep-dossie-${safeFilenamePart(dossie.produto.codigo)}-${dateStampSaoPaulo()}.pdf`,
    dossie: incluirValor
      ? dossie
      : {
          ...dossie,
          valorTotal: 0,
          produto: { ...dossie.produto, precoUnitario: 0 },
          saldos: dossie.saldos.map((s) => ({ ...s, valorEstoque: 0 })),
        },
  };
}

export async function exportarDossieProdutoExcel(
  user: AuthUser,
  codigoOuNome: string,
  opts: {
    filialId?: string | null;
    filialHint?: string | null;
    incluirValor?: boolean;
  } = {}
): Promise<{ buffer: Buffer; filename: string; dossie: DossieProduto }> {
  const incluirValor = opts.incluirValor !== false;
  const dossie = await carregarDossieProduto(user, codigoOuNome, opts);
  const wb = new ExcelJS.Workbook();
  wb.creator = "TEEP Estoque";
  wb.created = new Date();

  const info = wb.addWorksheet("Resumo");
  info.getColumn(1).width = 24;
  info.getColumn(2).width = 48;

  const logoBuf = brandAssetBuffer("logo-teep.png");
  if (logoBuf) {
    const imgId = wb.addImage({
      buffer: Buffer.from(logoBuf) as unknown as ExcelJS.Buffer,
      extension: "png",
    });
    info.addImage(imgId, {
      tl: { col: 0, row: 0 },
      ext: { width: 160, height: 46 },
    });
    info.getRow(1).height = 40;
    info.getRow(2).height = 8;
    info.addRow([]);
    info.addRow([]);
  }

  const infoRows: [string, string | number][] = [
    ["Relatório", "Dossiê de Produto — TEEP Estoque"],
    ["Gerado em", dossie.geradoEm],
    ["Usuário", `${dossie.usuario} (${dossie.perfil})`],
    ["Escopo", dossie.escopo],
    ["Código", dossie.produto.codigo],
    ["Descrição", dossie.produto.descricao],
    ["Unidade", dossie.produto.unidade],
    ["Categoria", dossie.produto.categoria],
    ...(incluirValor
      ? ([
          ["Preço unitário (R$)", dossie.produto.precoUnitario],
          ["Qtd. total estoque", dossie.qtyTotal],
          ["Valor estoque (R$)", dossie.valorTotal],
        ] as [string, string | number][])
      : ([["Qtd. total estoque", dossie.qtyTotal]] as [string, string | number][])),
    ["Fornecedores", dossie.fornecedores.length],
    ["Clientes", dossie.clientes.length],
  ];
  for (const [k, v] of infoRows) {
    const row = info.addRow([]);
    row.getCell(1).value = k;
    row.getCell(2).value = v;
    row.getCell(1).font = { bold: true, color: { argb: "FF475569" } };
    if (typeof v === "number") {
      row.getCell(2).numFmt = k.includes("R$") || k.includes("Preço") || k.includes("Valor")
        ? "R$ #,##0.00"
        : "#,##0.####";
      row.getCell(2).alignment = { horizontal: "left" };
    }
  }

  const styleHeader = (ws: ExcelJS.Worksheet) => {
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF5B8B83" },
    };
    header.alignment = { vertical: "middle" };
  };

  const estoque = wb.addWorksheet("Estoque", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  estoque.columns = [
    { header: "Sigla", key: "sigla", width: 10 },
    { header: "Filial", key: "filial", width: 24 },
    { header: "Saldo", key: "saldo", width: 12 },
    ...(incluirValor
      ? [{ header: "Valor (R$)", key: "valor", width: 14 }]
      : []),
  ];
  styleHeader(estoque);
  for (const s of dossie.saldos) {
    const row = estoque.addRow({
      sigla: s.filialSigla,
      filial: s.filialNome,
      saldo: s.qty,
      ...(incluirValor ? { valor: s.valorEstoque } : {}),
    });
    row.getCell("saldo").numFmt = "#,##0.####";
    if (incluirValor) row.getCell("valor").numFmt = "R$ #,##0.00";
  }

  const forn = wb.addWorksheet("Fornecedores", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  forn.columns = [
    { header: "Nome", key: "nome", width: 36 },
    { header: "Tipo", key: "tipo", width: 14 },
    { header: "Qtd. comprada", key: "qty", width: 14 },
    { header: "Última compra", key: "ultima", width: 14 },
    { header: "Movimentos", key: "mov", width: 12 },
  ];
  styleHeader(forn);
  for (const f of dossie.fornecedores) {
    const row = forn.addRow({
      nome: f.nome,
      tipo: f.tipo,
      qty: f.quantidadeTotal,
      ultima: formatUltimaData(f.ultimaData),
      mov: f.movimentos,
    });
    row.getCell("qty").numFmt = "#,##0.####";
  }

  const cli = wb.addWorksheet("Clientes", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  cli.columns = [
    { header: "Nome", key: "nome", width: 36 },
    { header: "Tipo", key: "tipo", width: 14 },
    { header: "Qtd. vendida", key: "qty", width: 14 },
    { header: "Última venda", key: "ultima", width: 14 },
    { header: "Movimentos", key: "mov", width: 12 },
  ];
  styleHeader(cli);
  for (const c of dossie.clientes) {
    const row = cli.addRow({
      nome: c.nome,
      tipo: c.tipo,
      qty: c.quantidadeTotal,
      ultima: formatUltimaData(c.ultimaData),
      mov: c.movimentos,
    });
    row.getCell("qty").numFmt = "#,##0.####";
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const dossieOut = incluirValor
    ? dossie
    : {
        ...dossie,
        valorTotal: 0,
        produto: { ...dossie.produto, precoUnitario: 0 },
        saldos: dossie.saldos.map((s) => ({ ...s, valorEstoque: 0 })),
      };
  return {
    buffer,
    filename: `teep-dossie-${safeFilenamePart(dossie.produto.codigo)}-${dateStampSaoPaulo()}.xlsx`,
    dossie: dossieOut,
  };
}

export async function gerarExportDossieProduto(
  user: AuthUser,
  codigoOuNome: string,
  format: AssistenteExportFormat,
  opts: {
    filialId?: string | null;
    filialHint?: string | null;
    incluirValor?: boolean;
  } = {}
): Promise<{ buffer: Buffer; filename: string; label: string; dossie: DossieProduto }> {
  if (format === "pdf") {
    const r = await exportarDossieProdutoPdf(user, codigoOuNome, opts);
    return {
      ...r,
      label: `Baixar PDF — ${r.dossie.produto.codigo}`,
    };
  }
  const r = await exportarDossieProdutoExcel(user, codigoOuNome, opts);
  return {
    ...r,
    label: `Baixar Excel — ${r.dossie.produto.codigo}`,
  };
}
