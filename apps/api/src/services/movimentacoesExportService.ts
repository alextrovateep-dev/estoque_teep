import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { htmlToPdf } from "../lib/pdf";
import { brandAssetBuffer, brandAssetDataUri } from "../lib/brandAssets";
import {
  assertOperadorPodeFilial,
  operadorFilialIds,
} from "../lib/filialScope";
import { dateStampSaoPaulo } from "./saldosExportService";

export const MOVIMENTACOES_EXPORT_LIMITE = 2000;

export type MovimentacoesFiltroQuery = {
  filialId?: string;
  status?: string;
  operacao?: string;
  produtoId?: string;
  tipoId?: string;
  clienteId?: string;
  parceiroTipo?: string;
  dataInicio?: string;
  dataFim?: string;
};

export type MovimentacaoExportRow = {
  dataMovimento: string;
  operacao: string;
  status: string;
  tipoNome: string;
  produtoCodigo: string;
  produtoDescricao: string;
  quantidade: number;
  filial: string;
  parceiroTipo: string;
  parceiroNome: string;
  parceiroDocumento: string;
  usuarioNome: string;
};

export type MovimentacoesExportMeta = {
  geradoEm: string;
  usuario: string;
  perfil: string;
  periodo: string;
  filtros: string;
  linhas: number;
  truncado: boolean;
  total: number;
  limite: number;
};

/** Lê filtros comuns da query HTTP (lista + export). */
export function parseMovimentacoesFiltroQuery(
  query: Record<string, unknown>
): MovimentacoesFiltroQuery {
  const str = (k: string) => {
    const v = query[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  return {
    filialId: str("filialId"),
    status: str("status"),
    operacao: str("operacao"),
    produtoId: str("produtoId"),
    tipoId: str("tipoId"),
    clienteId: str("clienteId"),
    parceiroTipo: str("parceiroTipo")?.toUpperCase(),
    dataInicio: str("dataInicio"),
    dataFim: str("dataFim"),
  };
}

/** Where Prisma compartilhado entre listagem e exportação. */
export function buildMovimentacoesWhere(
  user: AuthUser,
  q: MovimentacoesFiltroQuery
): Prisma.MovimentacaoWhereInput {
  const where: Prisma.MovimentacaoWhereInput = {};

  if (user.perfil === "OPERADOR") {
    const ids = operadorFilialIds(user);
    if (q.filialId) {
      assertOperadorPodeFilial(user, q.filialId);
      where.filialId = q.filialId;
    } else {
      where.filialId = { in: ids };
    }
  } else if (q.filialId) {
    where.filialId = q.filialId;
  }

  if (q.status) where.status = q.status;
  if (q.operacao) where.operacao = q.operacao;
  if (q.produtoId) where.produtoId = q.produtoId;
  if (q.tipoId) where.tipoId = q.tipoId;

  if (q.clienteId) {
    where.clienteId = q.clienteId;
  } else if (q.parceiroTipo === "FORNECEDOR") {
    where.cliente = { tipo: "FORNECEDOR" };
  } else if (q.parceiroTipo === "CLIENTE") {
    where.cliente = { tipo: { in: ["CLIENTE", "INTERNO"] } };
  }

  if (q.dataInicio || q.dataFim) {
    const range: Prisma.DateTimeFilter = {};
    if (q.dataInicio) {
      const d = new Date(`${q.dataInicio}T00:00:00`);
      if (!Number.isNaN(d.getTime())) range.gte = d;
    }
    if (q.dataFim) {
      const d = new Date(`${q.dataFim}T23:59:59.999`);
      if (!Number.isNaN(d.getTime())) range.lte = d;
    }
    if (range.gte || range.lte) where.dataMovimento = range;
  }

  return where;
}

function stampSaoPaulo() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
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

function fmtDataIso(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function formatPeriodo(q: MovimentacoesFiltroQuery): string {
  const a = q.dataInicio
    ? q.dataInicio.split("-").reverse().join("/")
    : null;
  const b = q.dataFim ? q.dataFim.split("-").reverse().join("/") : null;
  if (a && b) return `${a} – ${b}`;
  if (a) return `desde ${a}`;
  if (b) return `até ${b}`;
  return "todo o histórico";
}

async function descreverFiltros(
  q: MovimentacoesFiltroQuery
): Promise<string> {
  const parts: string[] = [];
  if (q.produtoId) {
    const p = await prisma.produto.findUnique({
      where: { id: q.produtoId },
      select: { codigo: true, descricao: true },
    });
    if (p) parts.push(`Produto: ${p.codigo}`);
  }
  if (q.tipoId) {
    const t = await prisma.tipoMovimentacao.findUnique({
      where: { id: q.tipoId },
      select: { nome: true },
    });
    if (t) parts.push(`Tipo: ${t.nome}`);
  }
  if (q.clienteId) {
    const c = await prisma.cliente.findUnique({
      where: { id: q.clienteId },
      select: { nome: true, tipo: true },
    });
    if (c) parts.push(`${c.tipo}: ${c.nome}`);
  } else if (q.parceiroTipo === "FORNECEDOR") {
    parts.push("Somente fornecedores");
  } else if (q.parceiroTipo === "CLIENTE") {
    parts.push("Somente clientes");
  }
  if (q.status) parts.push(`Status: ${q.status}`);
  if (q.operacao) parts.push(`Operação: ${q.operacao}`);
  return parts.length ? parts.join(" · ") : "Sem filtros extras";
}

export async function carregarMovimentacoesExport(
  user: AuthUser,
  q: MovimentacoesFiltroQuery
): Promise<{ rows: MovimentacaoExportRow[]; meta: MovimentacoesExportMeta }> {
  const where = buildMovimentacoesWhere(user, q);
  const total = await prisma.movimentacao.count({ where });
  const data = await prisma.movimentacao.findMany({
    where,
    include: {
      produto: { select: { codigo: true, descricao: true } },
      tipo: { select: { nome: true } },
      filial: { select: { sigla: true } },
      filialDestino: { select: { sigla: true } },
      cliente: { select: { nome: true, tipo: true, documento: true } },
      usuario: { select: { nome: true } },
    },
    orderBy: { dataMovimento: "desc" },
    take: MOVIMENTACOES_EXPORT_LIMITE,
  });

  const rows: MovimentacaoExportRow[] = data.map((m) => ({
    dataMovimento: m.dataMovimento.toISOString(),
    operacao: m.operacao,
    status: m.status,
    tipoNome: m.tipo.nome,
    produtoCodigo: m.produto.codigo,
    produtoDescricao: m.produto.descricao,
    quantidade: Number(m.quantidade),
    filial: m.filialDestino
      ? `${m.filial.sigla} → ${m.filialDestino.sigla}`
      : m.filial.sigla,
    parceiroTipo: m.cliente?.tipo || "",
    parceiroNome: m.cliente?.nome || "",
    parceiroDocumento: m.cliente?.documento || "",
    usuarioNome: m.usuario.nome,
  }));

  const meta: MovimentacoesExportMeta = {
    geradoEm: stampSaoPaulo(),
    usuario: user.nome,
    perfil: user.perfil,
    periodo: formatPeriodo(q),
    filtros: await descreverFiltros(q),
    linhas: rows.length,
    truncado: total > rows.length,
    total,
    limite: MOVIMENTACOES_EXPORT_LIMITE,
  };

  return { rows, meta };
}

function buildMovimentacoesHtml(
  rows: MovimentacaoExportRow[],
  meta: MovimentacoesExportMeta
): string {
  const logo = brandAssetDataUri("logo-teep.png");
  const brand = "#0f766e";
  const bodyRows = rows
    .map((r) => {
      const parceiro = r.parceiroNome
        ? `${escapeHtml(r.parceiroTipo === "FORNECEDOR" ? "Forn." : "Cli.")} ${escapeHtml(r.parceiroNome)}${
            r.parceiroDocumento
              ? `<br/><span class="muted">${escapeHtml(r.parceiroDocumento)}</span>`
              : ""
          }`
        : "—";
      return `<tr>
        <td>${escapeHtml(fmtDataIso(r.dataMovimento))}</td>
        <td><strong>${escapeHtml(r.operacao)}</strong><br/><span class="muted">${escapeHtml(r.status)}</span></td>
        <td>${escapeHtml(r.tipoNome)}<br/><span class="muted">${escapeHtml(r.produtoCodigo)} ${escapeHtml(r.produtoDescricao)}</span></td>
        <td class="num">${escapeHtml(qtyBr(r.quantidade))}</td>
        <td>${escapeHtml(r.filial)}</td>
        <td>${parceiro}</td>
        <td>${escapeHtml(r.usuarioNome)}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #0f172a; margin: 16px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 16px; }
    .brand img { height: 36px; }
    h1 { font-size: 16px; margin: 0 0 4px; color: ${brand}; }
    .meta { color: #475569; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; }
    th { background: ${brand}; color: #fff; text-align: left; padding: 6px 5px; font-size: 9px; text-transform: uppercase; }
    td { border-bottom: 1px solid #e2e8f0; padding: 5px; vertical-align: top; }
    .num { white-space: nowrap; }
    .muted { color: #64748b; font-size: 9px; }
    .foot { margin-top: 10px; color: #64748b; font-size: 9px; }
    .warn { color: #b45309; }
  </style>
</head>
<body>
  <div class="head">
    <div>
      ${logo ? `<div class="brand"><img src="${logo}" alt="TEEP" /></div>` : ""}
      <h1>Movimentações — TEEP Estoque</h1>
      <div class="meta">
        Gerado em ${escapeHtml(meta.geradoEm)} · ${escapeHtml(meta.usuario)} (${escapeHtml(meta.perfil)})<br/>
        Período: ${escapeHtml(meta.periodo)}<br/>
        Filtros: ${escapeHtml(meta.filtros)}
      </div>
    </div>
    <div class="meta" style="text-align:right">
      ${meta.linhas} linha(s)
      ${meta.truncado ? `<br/><span class="warn">Limitado a ${meta.limite} de ${meta.total}</span>` : ""}
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Data</th>
        <th>Operação</th>
        <th>Tipo / produto</th>
        <th>Qtd</th>
        <th>Filial</th>
        <th>Parceiro</th>
        <th>Usuário</th>
      </tr>
    </thead>
    <tbody>
      ${
        bodyRows ||
        `<tr><td colspan="7" style="text-align:center;padding:16px;color:#64748b">Nenhuma movimentação para exibir.</td></tr>`
      }
    </tbody>
  </table>
  <div class="foot">Exportação conforme filtros da tela Movimentações. Ordem: data mais recente primeiro.</div>
</body>
</html>`;
}

export async function exportarMovimentacoesPdf(
  user: AuthUser,
  q: MovimentacoesFiltroQuery
): Promise<{ buffer: Buffer; filename: string }> {
  const { rows, meta } = await carregarMovimentacoesExport(user, q);
  if (rows.length === 0) {
    throw new AppError(400, "Nenhuma movimentação para exportar com os filtros atuais");
  }
  const buffer = await htmlToPdf(buildMovimentacoesHtml(rows, meta));
  return {
    buffer,
    filename: `teep-movimentacoes-${dateStampSaoPaulo()}.pdf`,
  };
}

export async function exportarMovimentacoesExcel(
  user: AuthUser,
  q: MovimentacoesFiltroQuery
): Promise<{ buffer: Buffer; filename: string }> {
  const { rows, meta } = await carregarMovimentacoesExport(user, q);
  if (rows.length === 0) {
    throw new AppError(400, "Nenhuma movimentação para exportar com os filtros atuais");
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "TEEP Estoque";
  wb.created = new Date();

  const info = wb.addWorksheet("Resumo");
  info.getColumn(1).width = 22;
  info.getColumn(2).width = 56;

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
    info.addRow([]);
    info.addRow([]);
  }

  const infoRows: [string, string | number][] = [
    ["Relatório", "Movimentações — TEEP Estoque"],
    ["Gerado em", meta.geradoEm],
    ["Usuário", `${meta.usuario} (${meta.perfil})`],
    ["Período", meta.periodo],
    ["Filtros", meta.filtros],
    ["Linhas no relatório", meta.linhas],
  ];
  if (meta.truncado) {
    infoRows.push([
      "Atenção",
      `Limitado a ${meta.limite} de ${meta.total} registros`,
    ]);
  }
  for (const [k, v] of infoRows) {
    const row = info.addRow([]);
    row.getCell(1).value = k;
    row.getCell(2).value = v;
    row.getCell(1).font = { bold: true, color: { argb: "FF475569" } };
  }

  const ws = wb.addWorksheet("Movimentações", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = [
    { header: "Data", key: "data", width: 18 },
    { header: "Operação", key: "operacao", width: 12 },
    { header: "Status", key: "status", width: 12 },
    { header: "Tipo", key: "tipo", width: 22 },
    { header: "Código", key: "codigo", width: 14 },
    { header: "Produto", key: "produto", width: 32 },
    { header: "Qtd", key: "qtd", width: 10 },
    { header: "Filial", key: "filial", width: 12 },
    { header: "Parceiro tipo", key: "parceiroTipo", width: 12 },
    { header: "Parceiro", key: "parceiro", width: 24 },
    { header: "Documento", key: "documento", width: 18 },
    { header: "Usuário", key: "usuario", width: 20 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F766E" },
  };

  for (const r of rows) {
    ws.addRow({
      data: fmtDataIso(r.dataMovimento),
      operacao: r.operacao,
      status: r.status,
      tipo: r.tipoNome,
      codigo: r.produtoCodigo,
      produto: r.produtoDescricao,
      qtd: r.quantidade,
      filial: r.filial,
      parceiroTipo: r.parceiroTipo || "—",
      parceiro: r.parceiroNome || "—",
      documento: r.parceiroDocumento || "—",
      usuario: r.usuarioNome,
    });
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    buffer,
    filename: `teep-movimentacoes-${dateStampSaoPaulo()}.xlsx`,
  };
}
