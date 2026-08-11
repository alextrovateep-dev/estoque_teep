import ExcelJS from "exceljs";
import { BRAND_COLOR } from "@teep/shared";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { htmlToPdf } from "../lib/pdf";
import { brandAssetBuffer, brandAssetDataUri } from "../lib/brandAssets";
import { qtyReservadaTransferenciaPendente } from "./estoqueService";
import { dateStampSaoPaulo } from "./saldosExportService";

export type SimulacaoLinha = {
  produtoFilhoId: string;
  codigo: string;
  descricao: string;
  ativo: boolean;
  fantasma: boolean;
  qtdPorUnidade: number;
  qtdNecessaria: number;
  saldoAtual: number;
  saldoDisponivel: number;
  reservadoTransferencia: number;
  faltante: number;
  precoUnitario: number;
  valorNecessario: number;
  valorFaltante: number;
};

export type SimulacaoResult = {
  produto: {
    id: string;
    codigo: string;
    descricao: string;
    precoUnitario: number;
  };
  quantidade: number;
  filial: { id: string; nome: string; sigla: string };
  linhas: SimulacaoLinha[];
  totais: {
    valorComponentesNecessario: number;
    valorFaltanteComprar: number;
    itensComFalta: number;
    valorProdutoAcabado: number;
  };
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

export async function calcularSimulacaoArvore(opts: {
  produtoId: string;
  quantidade: number;
  filialId: string;
}): Promise<SimulacaoResult> {
  if (!(opts.quantidade > 0)) {
    throw new AppError(400, "Informe quantidade > 0");
  }
  const filialId = opts.filialId.trim();
  if (!filialId) throw new AppError(400, "Informe filialId");

  const pai = await prisma.produto.findUnique({
    where: { id: opts.produtoId },
    select: {
      id: true,
      codigo: true,
      descricao: true,
      precoUnitario: true,
    },
  });
  if (!pai) throw new AppError(404, "Produto não encontrado");

  const filial = await prisma.filial.findFirst({
    where: { id: filialId, ativo: true },
    select: { id: true, nome: true, sigla: true },
  });
  if (!filial) throw new AppError(400, "Estoque inválido");

  const bom = await prisma.produtoComponente.findMany({
    where: { produtoPaiId: pai.id },
    include: {
      produtoFilho: {
        select: {
          id: true,
          codigo: true,
          descricao: true,
          precoUnitario: true,
          ativo: true,
        },
      },
    },
    orderBy: { produtoFilho: { codigo: "asc" } },
  });
  if (!bom.length) {
    throw new AppError(400, "Produto sem árvore de componentes");
  }

  const filhoIds = bom.map((b) => b.produtoFilhoId);
  const estoques = await prisma.estoque.findMany({
    where: { filialId, produtoId: { in: filhoIds } },
    select: { produtoId: true, saldoAtual: true },
  });
  const saldoMap = new Map(
    estoques.map((e) => [e.produtoId, Number(e.saldoAtual)])
  );

  let valorNecessario = 0;
  let valorFaltante = 0;
  let itensComFalta = 0;
  const linhas: SimulacaoLinha[] = [];

  for (const b of bom) {
    const qtdPorUnidade = Number(b.quantidade);
    const qtdNecessaria = qtdPorUnidade * opts.quantidade;
    const preco = Number(b.produtoFilho.precoUnitario);
    const saldoBruto = saldoMap.get(b.produtoFilhoId) ?? 0;
    const reservada = b.fantasma
      ? 0
      : await qtyReservadaTransferenciaPendente(
          prisma,
          b.produtoFilhoId,
          filialId
        );
    const saldoDisponivel = Math.max(0, saldoBruto - reservada);
    const fantasma = b.fantasma;
    const faltante = fantasma
      ? 0
      : Math.max(0, qtdNecessaria - saldoDisponivel);
    const valorLinha = fantasma ? 0 : qtdNecessaria * preco;
    const valorFaltaLinha = faltante * preco;
    if (!fantasma) {
      valorNecessario += valorLinha;
      valorFaltante += valorFaltaLinha;
      if (faltante > 0) itensComFalta += 1;
    }
    linhas.push({
      produtoFilhoId: b.produtoFilhoId,
      codigo: b.produtoFilho.codigo,
      descricao: b.produtoFilho.descricao,
      ativo: b.produtoFilho.ativo,
      fantasma,
      qtdPorUnidade,
      qtdNecessaria,
      saldoAtual: saldoBruto,
      saldoDisponivel,
      reservadoTransferencia: reservada,
      faltante,
      precoUnitario: preco,
      valorNecessario: valorLinha,
      valorFaltante: valorFaltaLinha,
    });
  }

  return {
    produto: {
      id: pai.id,
      codigo: pai.codigo,
      descricao: pai.descricao,
      precoUnitario: Number(pai.precoUnitario),
    },
    quantidade: opts.quantidade,
    filial,
    linhas,
    totais: {
      valorComponentesNecessario: valorNecessario,
      valorFaltanteComprar: valorFaltante,
      itensComFalta,
      valorProdutoAcabado: Number(pai.precoUnitario) * opts.quantidade,
    },
  };
}

function buildSimulacaoHtml(data: SimulacaoResult, user: AuthUser): string {
  const geradoEm = stampSaoPaulo();
  const rows = data.linhas
    .map(
      (l) => `<tr class="${l.faltante > 0 ? "falta" : ""}">
        <td class="mono">${escapeHtml(l.codigo)}</td>
        <td>${escapeHtml(l.descricao)}${l.fantasma ? ' <span class="muted">· fantasma</span>' : ""}${l.ativo ? "" : ' <span class="muted">(inativo)</span>'}</td>
        <td class="num">${escapeHtml(qtyBr(l.qtdNecessaria))}</td>
        <td class="num">${l.fantasma ? "—" : escapeHtml(qtyBr(l.saldoDisponivel))}</td>
        <td class="num">${l.fantasma ? "—" : escapeHtml(qtyBr(l.faltante))}</td>
        <td class="num">${escapeHtml(moneyBr(l.precoUnitario))}</td>
        <td class="num">${l.fantasma ? "—" : escapeHtml(moneyBr(l.valorFaltante))}</td>
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
  <title>Simulação de necessidade — TEEP Estoque</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; margin: 0; font-size: 10px; }
    .brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 3px solid ${BRAND_COLOR}; padding-bottom: 8px; margin-bottom: 12px; }
    .brand-left { display: flex; align-items: center; gap: 12px; }
    .brand-left img { height: 32px; width: auto; display: block; }
    .brand .sub { color: #64748b; font-size: 10px; text-align: right; }
    .meta { margin-bottom: 12px; color: #475569; line-height: 1.5; }
    .totais { display: flex; gap: 16px; margin-bottom: 12px; flex-wrap: wrap; }
    .totais div { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 10px; min-width: 120px; }
    .totais .lbl { color: #64748b; font-size: 9px; text-transform: uppercase; }
    .totais .val { font-weight: 600; margin-top: 2px; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f1f5f9; text-align: left; padding: 4px 6px; border-bottom: 1px solid #cbd5e1; font-size: 9px; text-transform: uppercase; color: #475569; }
    th.num, td.num { text-align: right; }
    td { padding: 3px 6px; border-bottom: 1px solid #e2e8f0; }
    tr.falta td { background: #fff1f2; }
    .mono { font-family: ui-monospace, Consolas, monospace; font-size: 9px; }
    .muted { color: #94a3b8; }
    .foot { margin-top: 12px; color: #94a3b8; font-size: 9px; }
  </style>
</head>
<body>
  <div class="brand">
    <div class="brand-left">
      ${brandMark}
      <div>
        <div style="font-size:12px;font-weight:600;">Simulação de necessidade</div>
        <div style="font-size:9px;color:#64748b;margin-top:2px;">Árvore de produto · TEEP Estoque</div>
      </div>
    </div>
    <div class="sub">
      Gerado em ${escapeHtml(geradoEm)} (America/Sao_Paulo)<br/>
      ${escapeHtml(user.nome)} · ${escapeHtml(user.perfil)}
    </div>
  </div>
  <div class="meta">
    <div><strong>Produto:</strong> ${escapeHtml(data.produto.codigo)} — ${escapeHtml(data.produto.descricao)}</div>
    <div><strong>Quantidade a produzir:</strong> ${escapeHtml(qtyBr(data.quantidade))}</div>
    <div><strong>Estoque:</strong> ${escapeHtml(data.filial.sigla)} — ${escapeHtml(data.filial.nome)}</div>
  </div>
  <div class="totais">
    <div>
      <div class="lbl">Valor componentes</div>
      <div class="val">${escapeHtml(moneyBr(data.totais.valorComponentesNecessario))}</div>
    </div>
    <div>
      <div class="lbl">Falta comprar</div>
      <div class="val">${escapeHtml(moneyBr(data.totais.valorFaltanteComprar))}</div>
    </div>
    <div>
      <div class="lbl">Valor acabado</div>
      <div class="val">${escapeHtml(moneyBr(data.totais.valorProdutoAcabado))}</div>
    </div>
    <div>
      <div class="lbl">Itens com falta</div>
      <div class="val">${data.totais.itensComFalta}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Código</th>
        <th>Componente</th>
        <th class="num">Necessário</th>
        <th class="num">Disponível</th>
        <th class="num">Falta</th>
        <th class="num">Preço</th>
        <th class="num">Valor falta</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="foot">TEEP Estoque — simulação de necessidade (BOM)</div>
</body>
</html>`;
}

function styleHeader(header: ExcelJS.Row) {
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF5B8B83" },
  };
}

export async function exportarSimulacaoArvorePdf(
  user: AuthUser,
  opts: { produtoId: string; quantidade: number; filialId: string }
): Promise<{ buffer: Buffer; filename: string }> {
  const data = await calcularSimulacaoArvore(opts);
  const buffer = await htmlToPdf(buildSimulacaoHtml(data, user));
  const stamp = dateStampSaoPaulo();
  return {
    buffer,
    filename: `teep-simulacao-${data.produto.codigo}-${stamp}.pdf`,
  };
}

export async function exportarSimulacaoArvoreExcel(
  user: AuthUser,
  opts: { produtoId: string; quantidade: number; filialId: string }
): Promise<{ buffer: Buffer; filename: string }> {
  const data = await calcularSimulacaoArvore(opts);
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
    info.addRow([]);
    info.addRow([]);
  }
  for (const [k, v] of [
    ["Relatório", "Simulação de necessidade — TEEP Estoque"],
    ["Gerado em", stampSaoPaulo()],
    ["Usuário", `${user.nome} (${user.perfil})`],
    ["Produto", `${data.produto.codigo} — ${data.produto.descricao}`],
    ["Qtd. a produzir", data.quantidade],
    ["Estoque", `${data.filial.sigla} — ${data.filial.nome}`],
    ["Valor componentes", data.totais.valorComponentesNecessario],
    ["Falta comprar", data.totais.valorFaltanteComprar],
    ["Valor acabado", data.totais.valorProdutoAcabado],
    ["Itens com falta", data.totais.itensComFalta],
  ] as [string, string | number][]) {
    const row = info.addRow([]);
    row.getCell(1).value = k;
    row.getCell(2).value = v;
    row.getCell(1).font = { bold: true, color: { argb: "FF475569" } };
    if (
      typeof v === "number" &&
      (k === "Valor componentes" ||
        k === "Falta comprar" ||
        k === "Valor acabado")
    ) {
      row.getCell(2).numFmt = "R$ #,##0.00";
    }
  }

  const ws = wb.addWorksheet("Necessidade", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = [
    { header: "Código", key: "codigo", width: 16 },
    { header: "Componente", key: "descricao", width: 36 },
    { header: "Fantasma", key: "fantasma", width: 10 },
    { header: "Qtd por un.", key: "qtdUn", width: 12 },
    { header: "Necessário", key: "necessario", width: 12 },
    { header: "Disponível", key: "disponivel", width: 12 },
    { header: "Reservado", key: "reservado", width: 12 },
    { header: "Falta", key: "falta", width: 12 },
    { header: "Preço un. (R$)", key: "preco", width: 14 },
    { header: "Valor necessário (R$)", key: "valorNec", width: 18 },
    { header: "Valor falta (R$)", key: "valorFalta", width: 16 },
  ];
  styleHeader(ws.getRow(1));
  for (const l of data.linhas) {
    const row = ws.addRow({
      codigo: l.codigo,
      descricao: l.descricao,
      fantasma: l.fantasma ? "Sim" : "Não",
      qtdUn: l.qtdPorUnidade,
      necessario: l.qtdNecessaria,
      disponivel: l.fantasma ? null : l.saldoDisponivel,
      reservado: l.fantasma ? null : l.reservadoTransferencia,
      falta: l.fantasma ? null : l.faltante,
      preco: l.precoUnitario,
      valorNec: l.fantasma ? null : Math.round(l.valorNecessario * 100) / 100,
      valorFalta: l.fantasma ? null : Math.round(l.valorFaltante * 100) / 100,
    });
    for (const key of [
      "qtdUn",
      "necessario",
      "disponivel",
      "reservado",
      "falta",
    ]) {
      row.getCell(key).numFmt = "#,##0.####";
    }
    for (const key of ["preco", "valorNec", "valorFalta"]) {
      row.getCell(key).numFmt = "R$ #,##0.00";
    }
    if (l.faltante > 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF1F2" },
      };
    }
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const stamp = dateStampSaoPaulo();
  return {
    buffer,
    filename: `teep-simulacao-${data.produto.codigo}-${stamp}.xlsx`,
  };
}
