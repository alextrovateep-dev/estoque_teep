import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { BRAND_COLOR } from "@teep/shared";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { htmlToPdf } from "../lib/pdf";
import { brandAssetBuffer, brandAssetDataUri } from "../lib/brandAssets";
import { dateStampSaoPaulo } from "./saldosExportService";
import { calcularCustoBom } from "./bomCustoService";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIMITE_PAIS = 200;

export type ArvoreComponenteRow = {
  produtoFilhoId: string;
  codigo: string;
  descricao: string;
  quantidade: number;
  fantasma: boolean;
  /** Filho tem BOM própria (subárvore). */
  temBom: boolean;
  precoUnitario: number;
  valorLinha: number;
  ativo: boolean;
};

export type ArvoreExportRow = {
  produtoPaiId: string;
  codigo: string;
  descricao: string;
  categoriaNome: string;
  /** Acabado primeiro, depois semi — para layout do relatório. */
  grupo: "acabado" | "semi" | "outro";
  precoUnitario: number;
  qtdComponentes: number;
  totalComposicao: number;
  totalBaixa: number;
  componentes: ArvoreComponenteRow[];
};

export type ArvoreExportOpts = {
  q?: string | null;
  produtoPaiId?: string | null;
  /**
   * Inclui subárvores (ex.: KIT dentro do acabado).
   * Default: true quando há produtoPaiId (relatório de um item).
   */
  explodir?: boolean;
};

export type ArvoreExportMeta = {
  geradoEm: string;
  usuario: string;
  perfil: string;
  busca: string | null;
  linhasPai: number;
  linhasComponente: number;
  truncado: boolean;
  totalPais: number;
  limite: number;
  multinivel: boolean;
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

/** Ordem de exibição: produtos acabados → semi-acabados → demais. */
export function classificarGrupoArvore(
  categoriaNome: string,
  codigo: string
): "acabado" | "semi" | "outro" {
  const n = categoriaNome
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  if (
    /\bsemi/.test(n) ||
    /semi[- ]?acabad/.test(n) ||
    /\bkit\b/.test(n)
  ) {
    return "semi";
  }
  if (
    /acabad/.test(n) ||
    /produto.?final/.test(n) ||
    /finished/.test(n)
  ) {
    return "acabado";
  }
  if (/^kit[-_]/i.test(codigo)) return "semi";
  // Pai com BOM que não é kit → em geral produto acabado
  return "acabado";
}

const GRUPO_ORDEM: Record<"acabado" | "semi" | "outro", number> = {
  acabado: 0,
  semi: 1,
  outro: 2,
};

export function labelGrupoArvore(grupo: "acabado" | "semi" | "outro"): string {
  if (grupo === "acabado") return "Produtos acabados";
  if (grupo === "semi") return "Semi-acabados";
  return "Outros";
}

function stampSaoPaulo() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
}

export async function carregarArvoreExport(
  user: AuthUser,
  opts: ArvoreExportOpts
): Promise<{ rows: ArvoreExportRow[]; meta: ArvoreExportMeta }> {
  if (opts.produtoPaiId && !UUID_RE.test(opts.produtoPaiId)) {
    throw new AppError(400, "produtoPaiId inválido");
  }
  const q = (opts.q || "").trim();
  const explodir =
    opts.explodir !== undefined
      ? opts.explodir
      : Boolean(opts.produtoPaiId);

  const where = {
    ativo: true,
    componentesComoPai: { some: {} },
    ...(opts.produtoPaiId ? { id: opts.produtoPaiId } : {}),
    ...(q && !opts.produtoPaiId
      ? {
          OR: [
            { codigo: { contains: q, mode: "insensitive" as const } },
            { descricao: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [totalPais, paisRaiz] = await Promise.all([
    prisma.produto.count({ where }),
    prisma.produto.findMany({
      where,
      select: { id: true },
      orderBy: { codigo: "asc" },
      take: LIMITE_PAIS,
    }),
  ]);

  const rows: ArvoreExportRow[] = [];
  const loaded = new Set<string>();
  const queue: string[] = paisRaiz.map((p) => p.id);

  while (queue.length > 0 && rows.length < LIMITE_PAIS) {
    const paiId = queue.shift()!;
    if (loaded.has(paiId)) continue;
    loaded.add(paiId);

    const row = await prisma.$transaction((tx) => montarLinhaArvore(tx, paiId));
    if (!row) continue;
    rows.push(row);

    if (!explodir) continue;
    for (const c of row.componentes) {
      if (c.temBom && !loaded.has(c.produtoFilhoId)) {
        queue.push(c.produtoFilhoId);
      }
    }
  }

  rows.sort((a, b) => {
    const g = GRUPO_ORDEM[a.grupo] - GRUPO_ORDEM[b.grupo];
    if (g !== 0) return g;
    return a.codigo.localeCompare(b.codigo, "pt-BR");
  });

  const linhasComponente = rows.reduce((n, r) => n + r.componentes.length, 0);

  return {
    rows,
    meta: {
      geradoEm: stampSaoPaulo(),
      usuario: user.nome,
      perfil: user.perfil,
      busca: opts.produtoPaiId ? null : q || null,
      linhasPai: rows.length,
      linhasComponente,
      truncado: totalPais > LIMITE_PAIS || (explodir && queue.length > 0),
      totalPais,
      limite: LIMITE_PAIS,
      multinivel: explodir,
    },
  };
}

async function montarLinhaArvore(
  tx: Prisma.TransactionClient,
  paiId: string
): Promise<ArvoreExportRow | null> {
  const p = await tx.produto.findUnique({
    where: { id: paiId },
    select: {
      id: true,
      codigo: true,
      descricao: true,
      precoUnitario: true,
      ativo: true,
      categoria: { select: { nome: true } },
      componentesComoPai: {
        select: {
          quantidade: true,
          fantasma: true,
          produtoFilho: {
            select: {
              id: true,
              codigo: true,
              descricao: true,
              precoUnitario: true,
              ativo: true,
              _count: { select: { componentesComoPai: true } },
            },
          },
        },
        orderBy: { produtoFilho: { codigo: "asc" } },
      },
    },
  });
  if (!p || !p.ativo || p.componentesComoPai.length === 0) return null;

  const componentes: ArvoreComponenteRow[] = [];
  for (const c of p.componentesComoPai) {
    const qtd = Number(c.quantidade);
    const custoBom = await calcularCustoBom(c.produtoFilho.id, tx);
    const preco =
      custoBom !== null ? custoBom : Number(c.produtoFilho.precoUnitario);
    componentes.push({
      produtoFilhoId: c.produtoFilho.id,
      codigo: c.produtoFilho.codigo,
      descricao: c.produtoFilho.descricao,
      quantidade: qtd,
      fantasma: c.fantasma,
      temBom: c.produtoFilho._count.componentesComoPai > 0,
      precoUnitario: preco,
      valorLinha: qtd * preco,
      ativo: c.produtoFilho.ativo,
    });
  }
  let totalComposicao = 0;
  let totalBaixa = 0;
  for (const c of componentes) {
    totalComposicao += c.valorLinha;
    if (!c.fantasma) totalBaixa += c.valorLinha;
  }
  const categoriaNome = p.categoria?.nome || "";
  return {
    produtoPaiId: p.id,
    codigo: p.codigo,
    descricao: p.descricao,
    categoriaNome,
    grupo: classificarGrupoArvore(categoriaNome, p.codigo),
    precoUnitario: Number(p.precoUnitario),
    qtdComponentes: componentes.length,
    totalComposicao: Math.round(totalComposicao * 100) / 100,
    totalBaixa: Math.round(totalBaixa * 100) / 100,
    componentes,
  };
}

function buildArvoreHtml(
  rows: ArvoreExportRow[],
  meta: ArvoreExportMeta
): string {
  let lastGrupo: string | null = null;
  const sections = rows
    .map((p) => {
      const comps = p.componentes
        .map(
          (c) => `<tr>
            <td class="mono">${escapeHtml(c.codigo)}</td>
            <td>${escapeHtml(c.descricao)}${c.ativo ? "" : ' <span class="muted">(inativo)</span>'}</td>
            <td class="num">${escapeHtml(qtyBr(c.quantidade))}</td>
            <td class="num">${escapeHtml(moneyBr(c.precoUnitario))}</td>
            <td class="num">${escapeHtml(moneyBr(c.valorLinha))}</td>
            <td>${c.fantasma ? "Sim" : "—"}</td>
            <td>${c.temBom ? "Sim" : "—"}</td>
          </tr>`
        )
        .join("\n");
      const grupoHeader =
        p.grupo !== lastGrupo
          ? `<h1 class="grupo">${escapeHtml(labelGrupoArvore(p.grupo))}</h1>`
          : "";
      lastGrupo = p.grupo;
      return `
      ${grupoHeader}
      <section class="pai">
        <h2>${escapeHtml(p.codigo)} — ${escapeHtml(p.descricao)}</h2>
        <div class="pai-meta">
          ${p.categoriaNome ? `Categoria: ${escapeHtml(p.categoriaNome)} · ` : ""}
          Preço pai: ${escapeHtml(moneyBr(p.precoUnitario))} ·
          Composição: ${escapeHtml(moneyBr(p.totalComposicao))} ·
          Só baixa: ${escapeHtml(moneyBr(p.totalBaixa))} ·
          ${p.qtdComponentes} componente(s)
        </div>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Componente</th>
              <th class="num">Qtd</th>
              <th class="num">Preço un.</th>
              <th class="num">Valor</th>
              <th>Fantasma</th>
              <th>Subárvore</th>
            </tr>
          </thead>
          <tbody>${comps || `<tr><td colspan="7" class="muted">Sem componentes</td></tr>`}</tbody>
        </table>
      </section>`;
    })
    .join("\n");

  const logoUri = brandAssetDataUri("logo-teep.png");
  const brandMark = logoUri
    ? `<img src="${logoUri}" alt="TEEP" />`
    : `<h1>TEEP Estoque</h1>`;
  const bomLabel = meta.multinivel
    ? "BOM multinível (subárvores)"
    : "BOM 1 nível";
  const contagemArvores = meta.multinivel
    ? `<strong>Árvores no relatório:</strong> ${meta.linhasPai}${
        meta.truncado ? ` · truncado (limite ${meta.limite})` : ""
      }`
    : `<strong>Produtos pai:</strong> ${meta.linhasPai}${
        meta.truncado ? ` (de ${meta.totalPais})` : ""
      }`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Árvore de produto — TEEP Estoque</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; margin: 0; font-size: 10px; }
    .brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 3px solid ${BRAND_COLOR}; padding-bottom: 8px; margin-bottom: 12px; }
    .brand-left { display: flex; align-items: center; gap: 12px; }
    .brand-left img { height: 32px; width: auto; display: block; }
    .brand .sub { color: #64748b; font-size: 10px; text-align: right; }
    .meta { margin-bottom: 12px; color: #475569; line-height: 1.45; }
    .pai { margin-bottom: 18px; page-break-inside: avoid; }
    .pai h2 { margin: 0 0 4px; font-size: 12px; color: ${BRAND_COLOR}; }
    .pai-meta { color: #64748b; margin-bottom: 6px; font-size: 9px; }
    .grupo { margin: 16px 0 8px; font-size: 11px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    th { background: #f1f5f9; text-align: left; padding: 4px 6px; border-bottom: 1px solid #cbd5e1; font-size: 9px; text-transform: uppercase; color: #475569; }
    th.num, td.num { text-align: right; }
    td { padding: 3px 6px; border-bottom: 1px solid #e2e8f0; }
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
        <div style="font-size:12px;font-weight:600;">Relatório — Árvore de produto</div>
        <div style="font-size:9px;color:#64748b;margin-top:2px;">TEEP Estoque · ${escapeHtml(bomLabel)}</div>
      </div>
    </div>
    <div class="sub">
      Gerado em ${escapeHtml(meta.geradoEm)} (America/Sao_Paulo)<br/>
      ${escapeHtml(meta.usuario)} · ${escapeHtml(meta.perfil)}
    </div>
  </div>
  <div class="meta">
    <div>${contagemArvores} · <strong>Componentes:</strong> ${meta.linhasComponente}</div>
    ${meta.busca ? `<div><strong>Filtro:</strong> “${escapeHtml(meta.busca)}”</div>` : ""}
  </div>
  ${sections || `<p class="muted">Nenhuma árvore encontrada.</p>`}
  <div class="foot">TEEP Estoque — árvore de produto (BOM)</div>
</body>
</html>`;
}

export async function exportarArvorePdf(
  user: AuthUser,
  opts: ArvoreExportOpts
): Promise<{ buffer: Buffer; filename: string }> {
  const { rows, meta } = await carregarArvoreExport(user, opts);
  const buffer = await htmlToPdf(buildArvoreHtml(rows, meta));
  return {
    buffer,
    filename: `teep-arvores-${dateStampSaoPaulo()}.pdf`,
  };
}

export async function exportarArvoreExcel(
  user: AuthUser,
  opts: ArvoreExportOpts
): Promise<{ buffer: Buffer; filename: string }> {
  const { rows, meta } = await carregarArvoreExport(user, opts);
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
    ["Relatório", "Árvore de produto — TEEP Estoque"],
    [
      "Nível",
      meta.multinivel ? "Multinível (subárvores)" : "1 nível",
    ],
    ["Gerado em", meta.geradoEm],
    ["Usuário", `${meta.usuario} (${meta.perfil})`],
    ["Busca", meta.busca || "—"],
    ["Produtos pai", meta.linhasPai],
    ["Componentes", meta.linhasComponente],
  ] as [string, string | number][]) {
    const row = info.addRow([]);
    row.getCell(1).value = k;
    row.getCell(2).value = v;
    row.getCell(1).font = { bold: true, color: { argb: "FF475569" } };
  }

  const paisWs = wb.addWorksheet("Pais", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  paisWs.columns = [
    { header: "Grupo", key: "grupo", width: 18 },
    { header: "Categoria", key: "categoria", width: 18 },
    { header: "Código pai", key: "codigo", width: 16 },
    { header: "Descrição", key: "descricao", width: 36 },
    { header: "Preço pai (R$)", key: "preco", width: 14 },
    { header: "Qtd componentes", key: "qtd", width: 14 },
    { header: "Total composição (R$)", key: "total", width: 18 },
    { header: "Só baixa (R$)", key: "baixa", width: 14 },
  ];
  styleHeader(paisWs.getRow(1));
  for (const p of rows) {
    const row = paisWs.addRow({
      grupo: labelGrupoArvore(p.grupo),
      categoria: p.categoriaNome || "—",
      codigo: p.codigo,
      descricao: p.descricao,
      preco: p.precoUnitario,
      qtd: p.qtdComponentes,
      total: p.totalComposicao,
      baixa: p.totalBaixa,
    });
    row.getCell("preco").numFmt = "R$ #,##0.00";
    row.getCell("total").numFmt = "R$ #,##0.00";
    row.getCell("baixa").numFmt = "R$ #,##0.00";
  }

  const compWs = wb.addWorksheet("Componentes", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  compWs.columns = [
    { header: "Código pai", key: "pai", width: 16 },
    { header: "Código filho", key: "filho", width: 16 },
    { header: "Descrição filho", key: "descricao", width: 36 },
    { header: "Qtd", key: "qtd", width: 10 },
    { header: "Preço un. (R$)", key: "preco", width: 14 },
    { header: "Valor (R$)", key: "valor", width: 14 },
    { header: "Fantasma", key: "fantasma", width: 12 },
    { header: "Subárvore", key: "sub", width: 12 },
    { header: "Ativo", key: "ativo", width: 10 },
  ];
  styleHeader(compWs.getRow(1));
  for (const p of rows) {
    for (const c of p.componentes) {
      const row = compWs.addRow({
        pai: p.codigo,
        filho: c.codigo,
        descricao: c.descricao,
        qtd: c.quantidade,
        preco: c.precoUnitario,
        valor: Math.round(c.valorLinha * 100) / 100,
        fantasma: c.fantasma ? "Sim" : "Não",
        sub: c.temBom ? "Sim" : "Não",
        ativo: c.ativo ? "Sim" : "Não",
      });
      row.getCell("qtd").numFmt = "#,##0.####";
      row.getCell("preco").numFmt = "R$ #,##0.00";
      row.getCell("valor").numFmt = "R$ #,##0.00";
    }
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    buffer,
    filename: `teep-arvores-${dateStampSaoPaulo()}.xlsx`,
  };
}

function styleHeader(header: ExcelJS.Row) {
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF5B8B83" },
  };
}
