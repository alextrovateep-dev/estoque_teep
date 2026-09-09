import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import {
  BRAND_COLOR,
  RMA_ITEM_ETAPA,
  RMA_ITEM_ETAPA_LABELS,
  RMA_ITEM_STATUS,
  RMA_PROCESSO_STATUS,
} from "@teep/shared";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { htmlToPdf } from "../lib/pdf";
import { brandAssetBuffer, brandAssetDataUri } from "../lib/brandAssets";
import { operadorFilialIds } from "../lib/filialScope";
import { dateStampSaoPaulo } from "./saldosExportService";
import { parseDiaCivilSaoPaulo } from "./movimentacoesExportService";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIMITE = 3000;

/** Itens ainda no depósito RMA (em atendimento). */
export const ITEM_STATUS_EM_RMA = ["EM_ESTOQUE", "SEM_MANUTENCAO"] as const;

export const RMA_ITEM_STATUS_LABELS: Record<string, string> = {
  ABERTO: "Aberto",
  EM_ESTOQUE: "Em estoque RMA",
  SEM_MANUTENCAO: "Sem manutenção",
  DEVOLVIDO: "Devolvido",
  DESCARTADO: "Descartado",
  CANCELADO: "Cancelado",
};

export type RmaProdutoExportRow = {
  itemId: string;
  processoId: string;
  processoCurto: string;
  processoStatus: string;
  processoStatusLabel: string;
  criadoEm: string;
  criadoEmIso: string;
  clienteNome: string;
  clienteDocumento: string | null;
  filialSigla: string;
  filialNome: string;
  codigo: string;
  descricao: string;
  numeroSerie: string | null;
  quantidade: number;
  itemStatus: string;
  itemStatusLabel: string;
  etapa: string;
  etapaLabel: string;
  nfEntradaNumero: string | null;
  nfSaidaNumero: string | null;
  prazoManutencao: string | null;
  responsavelComercial: string | null;
};

export type RmaProdutosExportOpts = {
  q?: string | null;
  filialId?: string | null;
  clienteId?: string | null;
  produtoId?: string | null;
  etapa?: string | null;
  /** Default: EM_ESTOQUE+SEM_MANUTENCAO. "todos" = qualquer status ≠ CANCELADO. */
  itemStatus?: string | null;
  /** Default: ABERTO. "todos" = qualquer. */
  processoStatus?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
};

export type RmaProdutosExportMeta = {
  geradoEm: string;
  usuario: string;
  perfil: string;
  busca: string | null;
  filial: string | null;
  cliente: string | null;
  produto: string | null;
  etapa: string | null;
  itemStatusFiltro: string;
  processoStatusFiltro: string;
  periodo: string | null;
  /** Quantidade de linhas (itens) no resultado. */
  linhas: number;
  /** Soma das quantidades dos itens. */
  quantidadeTotal: number;
  truncado: boolean;
  total: number;
  limite: number;
};

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

function formatDataBr(isoOrYmd: string | Date | null | undefined): string {
  if (!isoOrYmd) return "—";
  const d = typeof isoOrYmd === "string" ? new Date(isoOrYmd) : isoOrYmd;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
  }).format(d);
}

function qtyBr(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function etapaLabel(etapa: string): string {
  return (RMA_ITEM_ETAPA_LABELS as Record<string, string>)[etapa] || etapa;
}

export function resolveItemStatusFiltro(
  raw: string | null | undefined
): string[] {
  const v = (raw || "").trim().toLowerCase();
  if (!v || v === "em_rma" || v === "no_rma") {
    return [...ITEM_STATUS_EM_RMA];
  }
  if (v === "todos" || v === "all") {
    return RMA_ITEM_STATUS.filter((s) => s !== "CANCELADO");
  }
  const upper = (raw || "").trim().toUpperCase();
  if ((RMA_ITEM_STATUS as readonly string[]).includes(upper)) {
    return [upper];
  }
  return [...ITEM_STATUS_EM_RMA];
}

export function resolveProcessoStatusFiltro(
  raw: string | null | undefined
): string | null {
  const v = (raw || "").trim().toLowerCase();
  if (!v || v === "aberto") return "ABERTO";
  if (v === "todos" || v === "all") return null;
  const upper = (raw || "").trim().toUpperCase();
  if ((RMA_PROCESSO_STATUS as readonly string[]).includes(upper)) {
    return upper;
  }
  return "ABERTO";
}

export async function carregarRmaProdutosExport(
  user: AuthUser,
  opts: RmaProdutosExportOpts
): Promise<{ rows: RmaProdutoExportRow[]; meta: RmaProdutosExportMeta }> {
  if (opts.filialId && !UUID_RE.test(opts.filialId)) {
    throw new AppError(400, "filialId inválido");
  }
  if (opts.clienteId && !UUID_RE.test(opts.clienteId)) {
    throw new AppError(400, "clienteId inválido");
  }
  if (opts.produtoId && !UUID_RE.test(opts.produtoId)) {
    throw new AppError(400, "produtoId inválido");
  }
  if (
    opts.etapa &&
    !(RMA_ITEM_ETAPA as readonly string[]).includes(opts.etapa)
  ) {
    throw new AppError(400, "etapa inválida");
  }

  const q = (opts.q || "").trim();
  const itemStatuses = resolveItemStatusFiltro(opts.itemStatus);
  const processoStatus = resolveProcessoStatusFiltro(opts.processoStatus);

  const processoWhere: Prisma.RmaProcessoWhereInput = {};
  if (user.perfil === "OPERADOR") {
    const ids = operadorFilialIds(user);
    if (ids.length === 0) {
      throw new AppError(403, "Operador sem filial");
    }
    processoWhere.filialId = { in: ids };
  }
  if (opts.filialId) {
    if (
      user.perfil === "OPERADOR" &&
      !operadorFilialIds(user).includes(opts.filialId)
    ) {
      throw new AppError(403, "Operador sem acesso a esta filial");
    }
    processoWhere.filialId = opts.filialId;
  }
  if (opts.clienteId) processoWhere.clienteId = opts.clienteId;
  if (processoStatus) processoWhere.status = processoStatus;

  const criadoEm: { gte?: Date; lte?: Date } = {};
  if (opts.dataInicio) {
    const d = parseDiaCivilSaoPaulo(opts.dataInicio, "inicio");
    if (d) criadoEm.gte = d;
  }
  if (opts.dataFim) {
    const d = parseDiaCivilSaoPaulo(opts.dataFim, "fim");
    if (d) criadoEm.lte = d;
  }
  if (criadoEm.gte || criadoEm.lte) processoWhere.criadoEm = criadoEm;

  const where: Prisma.RmaItemWhereInput = {
    status: { in: itemStatuses },
    processo: processoWhere,
    ...(opts.produtoId ? { produtoId: opts.produtoId } : {}),
    ...(opts.etapa ? { etapa: opts.etapa } : {}),
    ...(q
      ? {
          OR: [
            { produto: { codigo: { contains: q, mode: "insensitive" } } },
            { produto: { descricao: { contains: q, mode: "insensitive" } } },
            {
              unidadeSerie: {
                numeroSerie: { contains: q, mode: "insensitive" },
              },
            },
            {
              processo: {
                nfEntradaNumero: { contains: q, mode: "insensitive" },
              },
            },
            {
              processo: {
                nfSaidaNumero: { contains: q, mode: "insensitive" },
              },
            },
            {
              processo: {
                cliente: { nome: { contains: q, mode: "insensitive" } },
              },
            },
          ],
        }
      : {}),
  };

  const [total, itens, filialRef, clienteRef, produtoRef] = await Promise.all([
    prisma.rmaItem.count({ where }),
    prisma.rmaItem.findMany({
      where,
      select: {
        id: true,
        status: true,
        etapa: true,
        quantidade: true,
        produto: { select: { codigo: true, descricao: true } },
        unidadeSerie: { select: { numeroSerie: true } },
        processo: {
          select: {
            id: true,
            status: true,
            criadoEm: true,
            nfEntradaNumero: true,
            nfSaidaNumero: true,
            prazoManutencao: true,
            cliente: { select: { nome: true, documento: true } },
            filial: { select: { id: true, sigla: true, nome: true } },
            responsavelComercial: { select: { nome: true } },
          },
        },
      },
      orderBy: [{ processo: { criadoEm: "desc" } }, { id: "asc" }],
      take: LIMITE,
    }),
    opts.filialId
      ? prisma.filial.findUnique({
          where: { id: opts.filialId },
          select: { sigla: true, nome: true },
        })
      : Promise.resolve(null),
    opts.clienteId
      ? prisma.cliente.findUnique({
          where: { id: opts.clienteId },
          select: { nome: true, documento: true },
        })
      : Promise.resolve(null),
    opts.produtoId
      ? prisma.produto.findUnique({
          where: { id: opts.produtoId },
          select: { codigo: true, descricao: true },
        })
      : Promise.resolve(null),
  ]);

  const rows: RmaProdutoExportRow[] = itens.map((i) => {
    // prazoManutencao é Date civil; formata em America/Sao_Paulo (evita shift UTC).
    const prazo = i.processo.prazoManutencao
      ? formatDataBr(i.processo.prazoManutencao)
      : null;
    return {
      itemId: i.id,
      processoId: i.processo.id,
      processoCurto: i.processo.id.slice(0, 8),
      processoStatus: i.processo.status,
      processoStatusLabel:
        i.processo.status === "ABERTO"
          ? "Aberto"
          : i.processo.status === "FECHADO"
            ? "Fechado"
            : i.processo.status === "CANCELADO"
              ? "Cancelado"
              : i.processo.status,
      criadoEm: formatDataBr(i.processo.criadoEm),
      criadoEmIso: i.processo.criadoEm.toISOString(),
      clienteNome: i.processo.cliente.nome,
      clienteDocumento: i.processo.cliente.documento,
      filialSigla: i.processo.filial.sigla,
      filialNome: i.processo.filial.nome,
      codigo: i.produto.codigo,
      descricao: i.produto.descricao,
      numeroSerie: i.unidadeSerie?.numeroSerie ?? null,
      quantidade: Number(i.quantidade),
      itemStatus: i.status,
      itemStatusLabel: RMA_ITEM_STATUS_LABELS[i.status] || i.status,
      etapa: i.etapa,
      etapaLabel: etapaLabel(i.etapa),
      nfEntradaNumero: i.processo.nfEntradaNumero,
      nfSaidaNumero: i.processo.nfSaidaNumero,
      prazoManutencao: prazo && prazo !== "—" ? prazo : null,
      responsavelComercial: i.processo.responsavelComercial?.nome ?? null,
    };
  });

  const quantidadeTotal = rows.reduce((acc, r) => acc + r.quantidade, 0);
  const periodoParts: string[] = [];
  if (opts.dataInicio) periodoParts.push(`de ${opts.dataInicio}`);
  if (opts.dataFim) periodoParts.push(`até ${opts.dataFim}`);

  return {
    rows,
    meta: {
      geradoEm: stampSaoPaulo(),
      usuario: user.nome,
      perfil: user.perfil,
      busca: q || null,
      filial: filialRef
        ? `${filialRef.sigla} — ${filialRef.nome}`
        : opts.filialId
          ? "Filial"
          : null,
      cliente: clienteRef
        ? clienteRef.documento
          ? `${clienteRef.nome} (${clienteRef.documento})`
          : clienteRef.nome
        : opts.clienteId
          ? "Cliente"
          : null,
      produto: produtoRef
        ? `${produtoRef.codigo} — ${produtoRef.descricao}`
        : opts.produtoId
          ? "Produto"
          : null,
      etapa: opts.etapa ? etapaLabel(opts.etapa) : null,
      itemStatusFiltro:
        itemStatuses.length === ITEM_STATUS_EM_RMA.length &&
        ITEM_STATUS_EM_RMA.every((s) => itemStatuses.includes(s)) &&
        itemStatuses.every((s) =>
          (ITEM_STATUS_EM_RMA as readonly string[]).includes(s)
        )
          ? "Em RMA (estoque / sem manutenção)"
          : itemStatuses.length === 1
            ? RMA_ITEM_STATUS_LABELS[itemStatuses[0]!] || itemStatuses[0]!
            : "Itens (exceto cancelados)",
      processoStatusFiltro: processoStatus
        ? processoStatus === "ABERTO"
          ? "Processos abertos"
          : processoStatus === "FECHADO"
            ? "Processos fechados"
            : processoStatus === "CANCELADO"
              ? "Processos cancelados"
              : processoStatus
        : "Todos os processos",
      periodo: periodoParts.length ? periodoParts.join(" ") : null,
      linhas: rows.length,
      quantidadeTotal,
      truncado: total > LIMITE,
      total,
      limite: LIMITE,
    },
  };
}

function buildHtml(
  rows: RmaProdutoExportRow[],
  meta: RmaProdutosExportMeta
): string {
  const filtros: string[] = [];
  filtros.push(meta.processoStatusFiltro);
  filtros.push(meta.itemStatusFiltro);
  if (meta.filial) filtros.push(`estoque: ${escapeHtml(meta.filial)}`);
  if (meta.cliente) filtros.push(`cliente: ${escapeHtml(meta.cliente)}`);
  if (meta.produto) filtros.push(`produto: ${escapeHtml(meta.produto)}`);
  if (meta.etapa) filtros.push(`etapa: ${escapeHtml(meta.etapa)}`);
  if (meta.busca) filtros.push(`busca: “${escapeHtml(meta.busca)}”`);
  if (meta.periodo) filtros.push(escapeHtml(meta.periodo));

  const bodyRows = rows
    .map(
      (r) => `<tr>
        <td class="mono">${escapeHtml(r.processoCurto)}</td>
        <td>${escapeHtml(r.criadoEm)}</td>
        <td>${escapeHtml(r.clienteNome)}</td>
        <td>${escapeHtml(r.filialSigla)}</td>
        <td class="mono">${escapeHtml(r.codigo)}</td>
        <td>${escapeHtml(r.descricao)}</td>
        <td class="mono">${escapeHtml(r.numeroSerie || "—")}</td>
        <td class="num">${escapeHtml(qtyBr(r.quantidade))}</td>
        <td>${escapeHtml(r.etapaLabel)}</td>
        <td>${escapeHtml(r.itemStatusLabel)}</td>
        <td>${escapeHtml(r.nfEntradaNumero || "—")}</td>
        <td>${escapeHtml(r.prazoManutencao || "—")}</td>
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
  <title>Produtos em RMA — TEEP Estoque</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; margin: 0; font-size: 9px; }
    .brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 3px solid ${BRAND_COLOR}; padding-bottom: 8px; margin-bottom: 12px; }
    .brand-left { display: flex; align-items: center; gap: 12px; }
    .brand-left img { height: 32px; width: auto; display: block; }
    .brand h1 { margin: 0; font-size: 16px; color: ${BRAND_COLOR}; }
    .brand .sub { color: #64748b; font-size: 9px; text-align: right; }
    .meta { margin-bottom: 10px; color: #475569; line-height: 1.45; }
    .kpis { display: flex; gap: 12px; margin-bottom: 12px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 10px; min-width: 100px; }
    .kpi .l { color: #64748b; font-size: 8px; text-transform: uppercase; letter-spacing: 0.04em; }
    .kpi .v { font-size: 13px; font-weight: 600; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 4px 5px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #475569; font-size: 8px; text-transform: uppercase; letter-spacing: 0.03em; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.mono { font-family: ui-monospace, monospace; font-size: 8px; }
    .foot { margin-top: 10px; color: #64748b; font-size: 8px; }
  </style>
</head>
<body>
  <div class="brand">
    <div class="brand-left">${brandMark}<div><strong>Produtos em RMA</strong><div class="sub">Itens em processos de manutenção</div></div></div>
    <div class="sub">${escapeHtml(meta.geradoEm)}<br/>${escapeHtml(meta.usuario)} (${escapeHtml(meta.perfil)})</div>
  </div>
  <div class="meta"><strong>Filtros:</strong> ${filtros.join(" · ")}</div>
  <div class="kpis">
    <div class="kpi"><div class="l">Itens (linhas)</div><div class="v">${meta.linhas}</div></div>
    <div class="kpi"><div class="l">Qtd. itens</div><div class="v">${escapeHtml(qtyBr(meta.quantidadeTotal))}</div></div>
    ${
      meta.truncado
        ? `<div class="kpi"><div class="l">Atenção</div><div class="v" style="font-size:10px;color:#b45309">Limitado a ${meta.limite} de ${meta.total}</div></div>`
        : ""
    }
  </div>
  <table>
    <thead>
      <tr>
        <th>RMA</th>
        <th>Aberto em</th>
        <th>Cliente</th>
        <th>Estoque</th>
        <th>Código</th>
        <th>Descrição</th>
        <th>Série</th>
        <th class="num">Qtd. itens</th>
        <th>Etapa</th>
        <th>Status</th>
        <th>NF entrada</th>
        <th>Prazo</th>
      </tr>
    </thead>
    <tbody>
      ${
        bodyRows ||
        `<tr><td colspan="12" style="text-align:center;padding:16px;color:#64748b">Nenhum produto em RMA para exibir.</td></tr>`
      }
    </tbody>
  </table>
  <div class="foot">Relatório de itens por processo RMA. Padrão: processos abertos com itens ainda no estoque RMA.</div>
</body>
</html>`;
}

export async function exportarRmaProdutosPdf(
  user: AuthUser,
  opts: RmaProdutosExportOpts
): Promise<{ buffer: Buffer; filename: string }> {
  const { rows, meta } = await carregarRmaProdutosExport(user, opts);
  const buffer = await htmlToPdf(buildHtml(rows, meta));
  return {
    buffer,
    filename: `teep-rma-produtos-${dateStampSaoPaulo()}.pdf`,
  };
}

export async function exportarRmaProdutosExcel(
  user: AuthUser,
  opts: RmaProdutosExportOpts
): Promise<{ buffer: Buffer; filename: string }> {
  const { rows, meta } = await carregarRmaProdutosExport(user, opts);
  const wb = new ExcelJS.Workbook();
  wb.creator = "TEEP Estoque";
  wb.created = new Date();

  const info = wb.addWorksheet("Resumo");
  info.getColumn(1).width = 28;
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
    info.addRow([]);
    info.addRow([]);
  }

  const infoRows: [string, string | number][] = [
    ["Relatório", "Produtos em RMA — TEEP Estoque"],
    ["Gerado em", meta.geradoEm],
    ["Usuário", `${meta.usuario} (${meta.perfil})`],
    ["Processos", meta.processoStatusFiltro],
    ["Itens", meta.itemStatusFiltro],
    ["Estoque", meta.filial || "Todos"],
    ["Cliente", meta.cliente || "Todos"],
    ["Produto", meta.produto || "Todos"],
    ["Etapa", meta.etapa || "Todas"],
    ["Busca", meta.busca || "—"],
    ["Período", meta.periodo || "—"],
    ["Itens (linhas)", meta.linhas],
    ["Qtd. itens", meta.quantidadeTotal],
  ];
  if (meta.truncado) {
    infoRows.push([
      "Atenção",
      `Base limitada a ${meta.limite} de ${meta.total} itens`,
    ]);
  }
  for (const [k, v] of infoRows) {
    const row = info.addRow([]);
    row.getCell(1).value = k;
    row.getCell(2).value = v;
    row.getCell(1).font = { bold: true, color: { argb: "FF475569" } };
  }

  const ws = wb.addWorksheet("Produtos em RMA", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = [
    { header: "RMA (id)", key: "processoId", width: 38 },
    { header: "RMA", key: "processoCurto", width: 10 },
    { header: "Status processo", key: "processoStatus", width: 14 },
    { header: "Aberto em", key: "criadoEm", width: 12 },
    { header: "Cliente", key: "cliente", width: 32 },
    { header: "Documento", key: "documento", width: 18 },
    { header: "Estoque", key: "filial", width: 10 },
    { header: "Código", key: "codigo", width: 16 },
    { header: "Descrição", key: "descricao", width: 36 },
    { header: "Série", key: "serie", width: 18 },
    { header: "Qtd. itens", key: "qtd", width: 12 },
    { header: "Etapa", key: "etapa", width: 22 },
    { header: "Status item", key: "itemStatus", width: 16 },
    { header: "NF entrada", key: "nfEntrada", width: 14 },
    { header: "NF retorno", key: "nfSaida", width: 14 },
    { header: "Prazo manutenção", key: "prazo", width: 14 },
    { header: "Comercial", key: "comercial", width: 22 },
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
      processoId: r.processoId,
      processoCurto: r.processoCurto,
      processoStatus: r.processoStatusLabel,
      criadoEm: r.criadoEm,
      cliente: r.clienteNome,
      documento: r.clienteDocumento || "",
      filial: r.filialSigla,
      codigo: r.codigo,
      descricao: r.descricao,
      serie: r.numeroSerie || "",
      qtd: r.quantidade,
      etapa: r.etapaLabel,
      itemStatus: r.itemStatusLabel,
      nfEntrada: r.nfEntradaNumero || "",
      nfSaida: r.nfSaidaNumero || "",
      prazo: r.prazoManutencao || "",
      comercial: r.responsavelComercial || "",
    });
    row.getCell("qtd").numFmt = "#,##0.####";
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    buffer,
    filename: `teep-rma-produtos-${dateStampSaoPaulo()}.xlsx`,
  };
}
