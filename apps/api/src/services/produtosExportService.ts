import ExcelJS from "exceljs";
import { BRAND_COLOR } from "@teep/shared";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { htmlToPdf } from "../lib/pdf";
import { brandAssetBuffer, brandAssetDataUri } from "../lib/brandAssets";
import { dateStampSaoPaulo } from "./saldosExportService";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIMITE = 2000;

export type ProdutoExportRow = {
  id: string;
  codigo: string;
  descricao: string;
  categoriaNome: string;
  precoUnitario: number;
  unidade: string;
  estoqueMinimo: number;
  estoqueMaximo: number;
  ativo: boolean;
  controlaSerie: boolean;
};

export type ProdutosExportOpts = {
  q?: string | null;
  categoriaId?: string | null;
  /** null = todos; true = só ativos; false = só inativos */
  ativo?: boolean | null;
};

export type ProdutosExportMeta = {
  geradoEm: string;
  usuario: string;
  perfil: string;
  busca: string | null;
  categoria: string | null;
  filtroAtivo: string;
  linhas: number;
  truncado: boolean;
  total: number;
  limite: number;
};

function moneyBr(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

export async function carregarProdutosExport(
  user: AuthUser,
  opts: ProdutosExportOpts
): Promise<{ rows: ProdutoExportRow[]; meta: ProdutosExportMeta }> {
  if (opts.categoriaId && !UUID_RE.test(opts.categoriaId)) {
    throw new AppError(400, "categoriaId inválido");
  }
  const q = (opts.q || "").trim();
  const where = {
    ...(opts.ativo === true
      ? { ativo: true }
      : opts.ativo === false
        ? { ativo: false }
        : {}),
    ...(opts.categoriaId ? { categoriaId: opts.categoriaId } : {}),
    ...(q
      ? {
          OR: [
            { codigo: { contains: q, mode: "insensitive" as const } },
            { descricao: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, produtos, categoria] = await Promise.all([
    prisma.produto.count({ where }),
    prisma.produto.findMany({
      where,
      select: {
        id: true,
        codigo: true,
        descricao: true,
        precoUnitario: true,
        unidade: true,
        estoqueMinimo: true,
        estoqueMaximo: true,
        ativo: true,
        controlaSerie: true,
        categoria: { select: { nome: true } },
      },
      orderBy: { codigo: "asc" },
      take: LIMITE,
    }),
    opts.categoriaId
      ? prisma.categoria.findUnique({
          where: { id: opts.categoriaId },
          select: { nome: true },
        })
      : Promise.resolve(null),
  ]);

  const rows: ProdutoExportRow[] = produtos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    descricao: p.descricao,
    categoriaNome: p.categoria.nome,
    precoUnitario: Number(p.precoUnitario),
    unidade: p.unidade,
    estoqueMinimo: p.estoqueMinimo,
    estoqueMaximo: p.estoqueMaximo,
    ativo: p.ativo,
    controlaSerie: !!p.controlaSerie,
  }));

  return {
    rows,
    meta: {
      geradoEm: stampSaoPaulo(),
      usuario: user.nome,
      perfil: user.perfil,
      busca: q || null,
      categoria: categoria?.nome || (opts.categoriaId ? "Categoria" : null),
      filtroAtivo:
        opts.ativo === true
          ? "Somente ativos"
          : opts.ativo === false
            ? "Somente inativos"
            : "Todos",
      linhas: rows.length,
      truncado: total > LIMITE,
      total,
      limite: LIMITE,
    },
  };
}

function buildProdutosHtml(
  rows: ProdutoExportRow[],
  meta: ProdutosExportMeta
): string {
  const filtros: string[] = [];
  if (meta.categoria) filtros.push(`categoria: ${escapeHtml(meta.categoria)}`);
  if (meta.busca) filtros.push(`busca: “${escapeHtml(meta.busca)}”`);
  filtros.push(meta.filtroAtivo);

  const bodyRows = rows
    .map(
      (r) => `<tr>
        <td class="mono">${escapeHtml(r.codigo)}</td>
        <td>${escapeHtml(r.descricao)}${r.ativo ? "" : ' <span class="muted">(inativo)</span>'}</td>
        <td>${escapeHtml(r.categoriaNome)}</td>
        <td class="num">${escapeHtml(moneyBr(r.precoUnitario))}</td>
        <td>${escapeHtml(r.unidade)}</td>
        <td class="num muted">${r.estoqueMinimo || "—"}</td>
        <td class="num muted">${r.estoqueMaximo || "—"}</td>
        <td>${r.controlaSerie ? "Sim" : "—"}</td>
      </tr>`
    )
    .join("\n");

  const logoUri = brandAssetDataUri("logo-teep.png");
  const brandMark = logoUri
    ? `<img src="${logoUri}" alt="TEEP" />`
    : `<h1>TEEP Estoque</h1>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Produtos — TEEP Estoque</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; margin: 0; font-size: 10px; }
    .brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 3px solid ${BRAND_COLOR}; padding-bottom: 8px; margin-bottom: 12px; }
    .brand-left { display: flex; align-items: center; gap: 12px; }
    .brand-left img { height: 32px; width: auto; display: block; }
    .brand .sub { color: #64748b; font-size: 10px; text-align: right; }
    .meta { margin-bottom: 10px; color: #475569; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f1f5f9; text-align: left; padding: 5px 6px; border-bottom: 1px solid #cbd5e1; font-size: 9px; text-transform: uppercase; letter-spacing: 0.03em; color: #475569; }
    th.num, td.num { text-align: right; }
    td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .mono { font-family: ui-monospace, Consolas, monospace; font-size: 9px; }
    .muted { color: #94a3b8; }
    .foot { margin-top: 10px; color: #94a3b8; font-size: 9px; }
  </style>
</head>
<body>
  <div class="brand">
    <div class="brand-left">
      ${brandMark}
      <div>
        <div style="font-size:12px;font-weight:600;">Relatório de Produtos</div>
        <div style="font-size:9px;color:#64748b;margin-top:2px;">TEEP Estoque</div>
      </div>
    </div>
    <div class="sub">
      Gerado em ${escapeHtml(meta.geradoEm)} (America/Sao_Paulo)<br/>
      ${escapeHtml(meta.usuario)} · ${escapeHtml(meta.perfil)}
    </div>
  </div>
  <div class="meta">
    <div><strong>Linhas:</strong> ${meta.linhas}${meta.truncado ? ` (de ${meta.total})` : ""}</div>
    ${filtros.length ? `<div><strong>Filtros:</strong> ${filtros.join(" · ")}</div>` : ""}
  </div>
  <table>
    <thead>
      <tr>
        <th>Código</th>
        <th>Descrição</th>
        <th>Categoria</th>
        <th class="num">Preço</th>
        <th>Un.</th>
        <th class="num">Mín.</th>
        <th class="num">Máx.</th>
        <th>Série</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="foot">TEEP Estoque — relatório de produtos do cadastro</div>
</body>
</html>`;
}

export async function exportarProdutosPdf(
  user: AuthUser,
  opts: ProdutosExportOpts
): Promise<{ buffer: Buffer; filename: string }> {
  const { rows, meta } = await carregarProdutosExport(user, opts);
  const buffer = await htmlToPdf(buildProdutosHtml(rows, meta));
  return {
    buffer,
    filename: `teep-produtos-${dateStampSaoPaulo()}.pdf`,
  };
}

export async function exportarProdutosExcel(
  user: AuthUser,
  opts: ProdutosExportOpts
): Promise<{ buffer: Buffer; filename: string }> {
  const { rows, meta } = await carregarProdutosExport(user, opts);
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
    info.addRow([]);
    info.addRow([]);
  }
  for (const [k, v] of [
    ["Relatório", "Produtos — TEEP Estoque"],
    ["Gerado em", meta.geradoEm],
    ["Usuário", `${meta.usuario} (${meta.perfil})`],
    ["Busca", meta.busca || "—"],
    ["Categoria", meta.categoria || "—"],
    ["Ativo", meta.filtroAtivo],
    ["Linhas", meta.linhas],
  ] as [string, string | number][]) {
    const row = info.addRow([]);
    row.getCell(1).value = k;
    row.getCell(2).value = v;
    row.getCell(1).font = { bold: true, color: { argb: "FF475569" } };
  }

  const ws = wb.addWorksheet("Produtos", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = [
    { header: "Código", key: "codigo", width: 16 },
    { header: "Descrição", key: "descricao", width: 36 },
    { header: "Categoria", key: "categoria", width: 18 },
    { header: "Preço (R$)", key: "preco", width: 14 },
    { header: "Unidade", key: "unidade", width: 10 },
    { header: "Mín.", key: "min", width: 10 },
    { header: "Máx.", key: "max", width: 10 },
    { header: "Controla série", key: "serie", width: 14 },
    { header: "Ativo", key: "ativo", width: 10 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF5B8B83" },
  };
  for (const r of rows) {
    const row = ws.addRow({
      codigo: r.codigo,
      descricao: r.descricao,
      categoria: r.categoriaNome,
      preco: Math.round(r.precoUnitario * 100) / 100,
      unidade: r.unidade,
      min: r.estoqueMinimo || null,
      max: r.estoqueMaximo || null,
      serie: r.controlaSerie ? "Sim" : "Não",
      ativo: r.ativo ? "Sim" : "Não",
    });
    row.getCell("preco").numFmt = "R$ #,##0.00";
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    buffer,
    filename: `teep-produtos-${dateStampSaoPaulo()}.xlsx`,
  };
}
