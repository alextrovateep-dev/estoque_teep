import ExcelJS from "exceljs";
import {
  BRAND_COLOR,
  isAbaixoMinimo,
  isAcimaMaximo,
} from "@teep/shared";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { htmlToPdf } from "../lib/pdf";
import { brandAssetBuffer, brandAssetDataUri } from "../lib/brandAssets";
import {
  DASHBOARD_SALDOS_LIMITE,
  resolveDashboardFilialScope,
} from "./dashboardService";
import { operadorFilialIds } from "../lib/filialScope";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaldoExportRow = {
  id: string;
  filialSigla: string;
  filialNome: string;
  codigo: string;
  descricao: string;
  categoriaId: string;
  categoriaNome: string;
  saldoAtual: number;
  estoqueMinimo: number;
  estoqueMaximo: number;
  valor: number;
  abaixoMinimo: boolean;
  acimaMaximo: boolean;
  produtoAtivo: boolean;
};

export type SaldosExportOpts = {
  filialId?: string | null;
  q?: string | null;
  soAlertas?: boolean;
  categoriaId?: string | null;
  /** Se informado, exporta só esses estoque.id (ignora demais filtros de tela). */
  ids?: string[] | null;
};

export type SaldosExportMeta = {
  geradoEm: string;
  usuario: string;
  perfil: string;
  escopo: string;
  consolidado: boolean;
  soAlertas: boolean;
  busca: string | null;
  categoria: string | null;
  selecaoManual: number | null;
  truncado: boolean;
  totalCarregados: number;
  totalPosicoes: number;
  limite: number;
  /** Totais das LINHAS do relatório (já filtradas) */
  quantidadeTotal: number;
  valorTotal: number;
  linhas: number;
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

/** YYYY-MM-DD em America/Sao_Paulo (nome de arquivo). */
export function dateStampSaoPaulo(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Soma qty/valor das linhas que entram no relatório. */
export function totaisDasLinhas(rows: SaldoExportRow[]): {
  quantidadeTotal: number;
  valorTotal: number;
} {
  let quantidadeTotal = 0;
  let valorTotal = 0;
  for (const r of rows) {
    quantidadeTotal += r.saldoAtual;
    valorTotal += r.valor;
  }
  return {
    quantidadeTotal,
    valorTotal: Math.round(valorTotal * 100) / 100,
  };
}

export function filtrarSaldosExport(
  rows: SaldoExportRow[],
  opts: Pick<SaldosExportOpts, "q" | "soAlertas" | "categoriaId" | "ids">
): SaldoExportRow[] {
  const ids = (opts.ids || []).filter((id) => UUID_RE.test(id));
  if (ids.length > 0) {
    const set = new Set(ids);
    return rows.filter((s) => set.has(s.id));
  }

  const q = (opts.q || "").trim().toLowerCase();
  const categoriaId = opts.categoriaId?.trim() || "";
  return rows.filter((s) => {
    if (categoriaId && s.categoriaId !== categoriaId) return false;
    if (opts.soAlertas && !(s.abaixoMinimo || s.acimaMaximo)) return false;
    if (!q) return true;
    return (
      s.codigo.toLowerCase().includes(q) ||
      s.descricao.toLowerCase().includes(q) ||
      s.filialSigla.toLowerCase().includes(q) ||
      s.filialNome.toLowerCase().includes(q) ||
      s.categoriaNome.toLowerCase().includes(q)
    );
  });
}

export async function carregarSaldosExport(
  user: AuthUser,
  opts: SaldosExportOpts
): Promise<{ rows: SaldoExportRow[]; meta: SaldosExportMeta }> {
  if (opts.filialId && !UUID_RE.test(opts.filialId)) {
    throw new AppError(400, "filialId inválido");
  }
  if (opts.categoriaId && !UUID_RE.test(opts.categoriaId)) {
    throw new AppError(400, "categoriaId inválido");
  }
  const ids = (opts.ids || []).filter((id) => UUID_RE.test(id));
  if ((opts.ids?.length || 0) > 0 && ids.length === 0) {
    throw new AppError(400, "ids inválidos");
  }
  if (ids.length > DASHBOARD_SALDOS_LIMITE) {
    throw new AppError(400, `Máximo de ${DASHBOARD_SALDOS_LIMITE} itens na seleção`);
  }

  const { filialId, consolidado } = await resolveDashboardFilialScope(
    user,
    opts.filialId
  );

  const estoqueWhere = filialId
    ? { filialId }
    : { filial: { ativo: true } };

  const [totalPosicoes, estoques, filiais, categoria] = await Promise.all([
    prisma.estoque.count({ where: estoqueWhere }),
    prisma.estoque.findMany({
      where: estoqueWhere,
      include: {
        produto: {
          select: {
            codigo: true,
            descricao: true,
            precoUnitario: true,
            estoqueMinimo: true,
            estoqueMaximo: true,
            ativo: true,
            categoriaId: true,
            categoria: { select: { id: true, nome: true } },
          },
        },
        filial: { select: { id: true, nome: true, sigla: true } },
      },
      orderBy: [{ filial: { sigla: "asc" } }, { produto: { codigo: "asc" } }],
      take: DASHBOARD_SALDOS_LIMITE,
    }),
    user.perfil === "OPERADOR"
      ? prisma.filial.findMany({
          where: { id: { in: operadorFilialIds(user) } },
          select: { id: true, nome: true, sigla: true },
          orderBy: { nome: "asc" },
        })
      : prisma.filial.findMany({
          where: { ativo: true },
          select: { id: true, nome: true, sigla: true },
          orderBy: { nome: "asc" },
        }),
    opts.categoriaId
      ? prisma.categoria.findUnique({
          where: { id: opts.categoriaId },
          select: { nome: true },
        })
      : Promise.resolve(null),
  ]);

  const mapped: SaldoExportRow[] = estoques.map((e) => {
    const saldo = Number(e.saldoAtual);
    const preco = Number(e.produto.precoUnitario);
    const min = e.produto.estoqueMinimo;
    const max = e.produto.estoqueMaximo;
    return {
      id: e.id,
      filialSigla: e.filial.sigla,
      filialNome: e.filial.nome,
      codigo: e.produto.codigo,
      descricao: e.produto.descricao,
      categoriaId: e.produto.categoriaId,
      categoriaNome: e.produto.categoria.nome,
      saldoAtual: saldo,
      estoqueMinimo: min,
      estoqueMaximo: max,
      valor: saldo * preco,
      abaixoMinimo: isAbaixoMinimo(saldo, min),
      acimaMaximo: isAcimaMaximo(saldo, max),
      produtoAtivo: e.produto.ativo,
    };
  });

  const rows = filtrarSaldosExport(mapped, {
    ...opts,
    ids: ids.length > 0 ? ids : null,
  });
  const totais = totaisDasLinhas(rows);

  const filialFound = filialId
    ? filiais.find((f) => f.id === filialId)
    : null;
  const escopo = consolidado
    ? "Todas (consolidado)"
    : filialFound
      ? `${filialFound.sigla} — ${filialFound.nome}`
      : "Filial";

  return {
    rows,
    meta: {
      geradoEm: stampSaoPaulo(),
      usuario: user.nome,
      perfil: user.perfil,
      escopo,
      consolidado,
      soAlertas: ids.length > 0 ? false : !!opts.soAlertas,
      busca: ids.length > 0 ? null : (opts.q || "").trim() || null,
      categoria:
        ids.length > 0
          ? null
          : categoria?.nome || (opts.categoriaId ? "Categoria" : null),
      selecaoManual: ids.length > 0 ? rows.length : null,
      truncado: totalPosicoes > DASHBOARD_SALDOS_LIMITE,
      totalCarregados: mapped.length,
      totalPosicoes,
      limite: DASHBOARD_SALDOS_LIMITE,
      quantidadeTotal: totais.quantidadeTotal,
      valorTotal: totais.valorTotal,
      linhas: rows.length,
    },
  };
}

function buildSaldosHtml(rows: SaldoExportRow[], meta: SaldosExportMeta): string {
  const filtros: string[] = [];
  if (meta.selecaoManual != null) {
    filtros.push(`seleção manual (${meta.selecaoManual} itens)`);
  } else {
    if (meta.soAlertas) filtros.push("só fora do mín./máx.");
    if (meta.categoria) filtros.push(`categoria: ${escapeHtml(meta.categoria)}`);
    if (meta.busca) filtros.push(`busca: “${escapeHtml(meta.busca)}”`);
  }

  const bodyRows = rows
    .map((r) => {
      const alert = r.abaixoMinimo || r.acimaMaximo;
      const trClass = alert ? ' class="alerta"' : "";
      return `<tr${trClass}>
        <td>${escapeHtml(r.filialSigla)}</td>
        <td class="mono">${escapeHtml(r.codigo)}</td>
        <td>${escapeHtml(r.descricao)}${r.produtoAtivo ? "" : ' <span class="muted">(inativo)</span>'}</td>
        <td>${escapeHtml(r.categoriaNome)}</td>
        <td class="num">${escapeHtml(qtyBr(r.saldoAtual))}</td>
        <td class="num muted">${r.estoqueMinimo || "—"}</td>
        <td class="num muted">${r.estoqueMaximo || "—"}</td>
        <td class="num">${escapeHtml(moneyBr(r.valor))}</td>
      </tr>`;
    })
    .join("\n");

  const logoUri = brandAssetDataUri("logo-teep.png");
  const brandMark = logoUri
    ? `<img src="${logoUri}" alt="TEEP" />`
    : `<h1>TEEP Estoque</h1>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Saldos — TEEP Estoque</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #0f172a;
      margin: 0;
      font-size: 10px;
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 3px solid ${BRAND_COLOR};
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .brand-left { display: flex; align-items: center; gap: 12px; }
    .brand-left img { height: 32px; width: auto; display: block; }
    .brand h1 {
      margin: 0;
      font-size: 18px;
      color: ${BRAND_COLOR};
      letter-spacing: 0.02em;
    }
    .brand .sub { color: #64748b; font-size: 10px; text-align: right; }
    .meta { margin-bottom: 10px; color: #475569; line-height: 1.45; }
    .kpis { display: flex; gap: 16px; margin-bottom: 12px; }
    .kpi {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 6px 10px;
      min-width: 120px;
    }
    .kpi .l { color: #64748b; font-size: 9px; }
    .kpi .v { font-size: 13px; font-weight: 650; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th {
      background: #f1f5f9;
      text-align: left;
      padding: 5px 6px;
      border-bottom: 1px solid #cbd5e1;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #475569;
    }
    th.num, td.num { text-align: right; }
    td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tr.alerta { background: #fffbeb; }
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
        <div style="font-size:12px;font-weight:600;color:#0f172a;">Relatório de Saldos</div>
        <div style="font-size:9px;color:#64748b;margin-top:2px;">TEEP Estoque</div>
      </div>
    </div>
    <div class="sub">
      Gerado em ${escapeHtml(meta.geradoEm)} (America/Sao_Paulo)<br/>
      ${escapeHtml(meta.usuario)} · ${escapeHtml(meta.perfil)}
    </div>
  </div>
  <div class="meta">
    <div><strong>Escopo:</strong> ${escapeHtml(meta.escopo)}</div>
    ${filtros.length ? `<div><strong>Filtros:</strong> ${filtros.join(" · ")}</div>` : ""}
    ${
      meta.truncado
        ? `<div style="color:#b45309"><strong>Atenção:</strong> base limitada a ${meta.limite} de ${meta.totalPosicoes} posições (mesmo limite do dashboard).</div>`
        : ""
    }
  </div>
  <div class="kpis">
    <div class="kpi"><div class="l">Qtd. no relatório</div><div class="v">${escapeHtml(qtyBr(meta.quantidadeTotal))}</div></div>
    <div class="kpi"><div class="l">Valor no relatório</div><div class="v">${escapeHtml(moneyBr(meta.valorTotal))}</div></div>
    <div class="kpi"><div class="l">Linhas</div><div class="v">${meta.linhas}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Filial</th>
        <th>Código</th>
        <th>Descrição</th>
        <th>Categoria</th>
        <th class="num">Saldo</th>
        <th class="num">Mín.</th>
        <th class="num">Máx.</th>
        <th class="num">Valor</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || `<tr><td colspan="8" style="text-align:center;padding:16px;color:#64748b">Nenhum saldo para exibir.</td></tr>`}
    </tbody>
  </table>
  <div class="foot">Totais = soma das linhas deste relatório (após filtros). Valor = saldo × preço cadastrado. Destaque = fora do mín./máx.</div>
</body>
</html>`;
}

export async function exportarSaldosPdf(
  user: AuthUser,
  opts: SaldosExportOpts
): Promise<{ buffer: Buffer; filename: string }> {
  const { rows, meta } = await carregarSaldosExport(user, opts);
  const html = buildSaldosHtml(rows, meta);
  const buffer = await htmlToPdf(html);
  return {
    buffer,
    filename: `teep-saldos-${dateStampSaoPaulo()}.pdf`,
  };
}

export async function exportarSaldosExcel(
  user: AuthUser,
  opts: SaldosExportOpts
): Promise<{ buffer: Buffer; filename: string }> {
  const { rows, meta } = await carregarSaldosExport(user, opts);
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
    // Empurra metadados para baixo do logo
    info.addRow([]);
    info.addRow([]);
  }

  const infoRows: [string, string | number][] = [
    ["Relatório", "Saldos — TEEP Estoque"],
    ["Gerado em", meta.geradoEm],
    ["Usuário", `${meta.usuario} (${meta.perfil})`],
    ["Escopo", meta.escopo],
    [
      "Modo",
      meta.selecaoManual != null
        ? `Seleção manual (${meta.selecaoManual} itens)`
        : "Filtros da tela",
    ],
    ["Filtro alertas", meta.soAlertas ? "Sim" : "Não"],
    ["Categoria", meta.categoria || "—"],
    ["Busca", meta.busca || "—"],
    ["Linhas no relatório", meta.linhas],
    ["Qtd. no relatório", meta.quantidadeTotal],
    ["Valor no relatório (R$)", meta.valorTotal],
  ];
  if (meta.truncado) {
    infoRows.push([
      "Atenção",
      `Base limitada a ${meta.limite} de ${meta.totalPosicoes} posições`,
    ]);
  }
  for (const [k, v] of infoRows) {
    const row = info.addRow([]);
    row.getCell(1).value = k;
    row.getCell(2).value = v;
    row.getCell(1).font = { bold: true, color: { argb: "FF475569" } };
    if (typeof v === "number") {
      row.getCell(2).numFmt = k.includes("Valor")
        ? "R$ #,##0.00"
        : "#,##0.####";
      row.getCell(2).alignment = { horizontal: "left" };
    }
  }

  const ws = wb.addWorksheet("Saldos", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = [
    { header: "Filial", key: "filial", width: 10 },
    { header: "Filial nome", key: "filialNome", width: 22 },
    { header: "Código", key: "codigo", width: 16 },
    { header: "Descrição", key: "descricao", width: 36 },
    { header: "Categoria", key: "categoria", width: 18 },
    { header: "Saldo", key: "saldo", width: 12 },
    { header: "Mín.", key: "min", width: 10 },
    { header: "Máx.", key: "max", width: 10 },
    { header: "Valor (R$)", key: "valor", width: 14 },
    { header: "Alerta", key: "alerta", width: 14 },
    { header: "Produto ativo", key: "ativo", width: 12 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF5B8B83" },
  };
  header.alignment = { vertical: "middle" };

  for (const r of rows) {
    const alerta = r.abaixoMinimo
      ? "Abaixo mín."
      : r.acimaMaximo
        ? "Acima máx."
        : "";
    const row = ws.addRow({
      filial: r.filialSigla,
      filialNome: r.filialNome,
      codigo: r.codigo,
      descricao: r.descricao,
      categoria: r.categoriaNome,
      saldo: r.saldoAtual,
      min: r.estoqueMinimo || null,
      max: r.estoqueMaximo || null,
      valor: Math.round(r.valor * 100) / 100,
      alerta,
      ativo: r.produtoAtivo ? "Sim" : "Não",
    });
    row.getCell("saldo").numFmt = "#,##0.####";
    row.getCell("valor").numFmt = "R$ #,##0.00";
    if (alerta) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFBEB" },
      };
    }
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    buffer,
    filename: `teep-saldos-${dateStampSaoPaulo()}.xlsx`,
  };
}
