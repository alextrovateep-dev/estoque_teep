import {
  isAbaixoMinimo,
  isAcimaMaximo,
  TIPO_TRANSF_ENVIADA,
  TIPO_TRANSF_RECEBIDA,
} from "@teep/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import {
  operadorFilialIds,
  resolveOperadorFilialId,
} from "../lib/filialScope";

const SALDOS_LIMITE = 2000;
const ALERTAS_LIMITE = 100;
/** Fuso operacional TEEP (evita “hoje” errado se a API rodar em UTC) */
const TZ = "America/Sao_Paulo";

export { SALDOS_LIMITE as DASHBOARD_SALDOS_LIMITE };

export type DashboardFilialScope = {
  filialId: string | null;
  consolidado: boolean;
};

/** Mesma regra de escopo do GET /dashboard (Admin/Gerente × Operador). */
export async function resolveDashboardFilialScope(
  user: AuthUser,
  filialIdFiltro?: string | null
): Promise<DashboardFilialScope> {
  if (user.perfil === "OPERADOR") {
    if (filialIdFiltro) {
      return {
        filialId: resolveOperadorFilialId(user, filialIdFiltro),
        consolidado: false,
      };
    }
    return {
      filialId: resolveOperadorFilialId(user, null),
      consolidado: false,
    };
  }
  if (filialIdFiltro) {
    const filial = await prisma.filial.findFirst({
      where: { id: filialIdFiltro, ativo: true },
      select: { id: true },
    });
    if (!filial) throw new AppError(400, "Filial inválida ou inativa");
    return { filialId: filial.id, consolidado: false };
  }
  return { filialId: null, consolidado: true };
}

/**
 * Início do dia civil em America/Sao_Paulo, como Instant UTC.
 * Ex.: 2026-07-28 00:00 BRT → 2026-07-28T03:00:00.000Z
 */
function startOfDaySaoPaulo(daysBack = 0): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);
  // Meia-noite BRT = 03:00 UTC (sem DST no Brasil desde 2019)
  const utc = Date.UTC(y, m - 1, d, 3, 0, 0, 0);
  return new Date(utc - daysBack * 24 * 60 * 60 * 1000);
}

function movWhereFilial(filialId: string | null) {
  if (!filialId) return {};
  return {
    OR: [{ filialId }, { filialDestinoId: filialId }],
  };
}

type KpiRow = {
  posicoes_com_saldo: number;
  skus_com_saldo: number;
  quantidade_total: unknown;
  valor_total: unknown;
  alertas_minimo: number;
  alertas_maximo: number;
};

type AlertaRow = {
  produto_id: string;
  codigo: string;
  descricao: string;
  filial_id: string;
  filial_sigla: string;
  saldo_atual: unknown;
  estoque_minimo: number;
  estoque_maximo: number;
  tipo: "MINIMO" | "MAXIMO";
};

async function agregarKpisEstoque(filialId: string | null): Promise<{
  posicoesComSaldo: number;
  skusComSaldo: number;
  quantidadeTotal: number;
  valorTotal: number;
  alertasMinimo: number;
  alertasMaximo: number;
}> {
  const rows = filialId
    ? await prisma.$queryRaw<KpiRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE e.saldo_atual > 0)::int AS posicoes_com_saldo,
          COUNT(DISTINCT e.produto_id) FILTER (WHERE e.saldo_atual > 0)::int AS skus_com_saldo,
          COALESCE(SUM(e.saldo_atual), 0) AS quantidade_total,
          COALESCE(SUM(e.saldo_atual * p.preco_unitario), 0) AS valor_total,
          COUNT(*) FILTER (
            WHERE p.estoque_minimo > 0 AND e.saldo_atual <= p.estoque_minimo
          )::int AS alertas_minimo,
          COUNT(*) FILTER (
            WHERE p.estoque_maximo > 0 AND e.saldo_atual >= p.estoque_maximo
          )::int AS alertas_maximo
        FROM estoques e
        INNER JOIN produtos p ON p.id = e.produto_id
        WHERE e.filial_id = ${filialId}::uuid
      `
    : await prisma.$queryRaw<KpiRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE e.saldo_atual > 0)::int AS posicoes_com_saldo,
          COUNT(DISTINCT e.produto_id) FILTER (WHERE e.saldo_atual > 0)::int AS skus_com_saldo,
          COALESCE(SUM(e.saldo_atual), 0) AS quantidade_total,
          COALESCE(SUM(e.saldo_atual * p.preco_unitario), 0) AS valor_total,
          COUNT(*) FILTER (
            WHERE p.estoque_minimo > 0 AND e.saldo_atual <= p.estoque_minimo
          )::int AS alertas_minimo,
          COUNT(*) FILTER (
            WHERE p.estoque_maximo > 0 AND e.saldo_atual >= p.estoque_maximo
          )::int AS alertas_maximo
        FROM estoques e
        INNER JOIN produtos p ON p.id = e.produto_id
        INNER JOIN filiais f ON f.id = e.filial_id AND f.ativo = true
      `;

  const r = rows[0];
  return {
    posicoesComSaldo: Number(r?.posicoes_com_saldo ?? 0),
    skusComSaldo: Number(r?.skus_com_saldo ?? 0),
    quantidadeTotal: Number(r?.quantidade_total ?? 0),
    valorTotal: Number(r?.valor_total ?? 0),
    alertasMinimo: Number(r?.alertas_minimo ?? 0),
    alertasMaximo: Number(r?.alertas_maximo ?? 0),
  };
}

async function listarAlertas(filialId: string | null, limite: number) {
  const lim = Prisma.raw(String(Math.min(Math.max(1, Math.floor(limite)), 500)));
  const rows = filialId
    ? await prisma.$queryRaw<AlertaRow[]>`
        SELECT * FROM (
          SELECT
            e.produto_id,
            p.codigo,
            p.descricao,
            e.filial_id,
            f.sigla AS filial_sigla,
            e.saldo_atual,
            p.estoque_minimo,
            p.estoque_maximo,
            'MINIMO'::text AS tipo
          FROM estoques e
          INNER JOIN produtos p ON p.id = e.produto_id
          INNER JOIN filiais f ON f.id = e.filial_id
          WHERE e.filial_id = ${filialId}::uuid
            AND p.estoque_minimo > 0
            AND e.saldo_atual <= p.estoque_minimo
          UNION ALL
          SELECT
            e.produto_id,
            p.codigo,
            p.descricao,
            e.filial_id,
            f.sigla AS filial_sigla,
            e.saldo_atual,
            p.estoque_minimo,
            p.estoque_maximo,
            'MAXIMO'::text AS tipo
          FROM estoques e
          INNER JOIN produtos p ON p.id = e.produto_id
          INNER JOIN filiais f ON f.id = e.filial_id
          WHERE e.filial_id = ${filialId}::uuid
            AND p.estoque_maximo > 0
            AND e.saldo_atual >= p.estoque_maximo
        ) a
        ORDER BY
          CASE WHEN a.tipo = 'MINIMO' THEN a.saldo_atual - a.estoque_minimo
               ELSE a.estoque_maximo - a.saldo_atual END ASC,
          a.codigo ASC
        LIMIT ${lim}
      `
    : await prisma.$queryRaw<AlertaRow[]>`
        SELECT * FROM (
          SELECT
            e.produto_id,
            p.codigo,
            p.descricao,
            e.filial_id,
            f.sigla AS filial_sigla,
            e.saldo_atual,
            p.estoque_minimo,
            p.estoque_maximo,
            'MINIMO'::text AS tipo
          FROM estoques e
          INNER JOIN produtos p ON p.id = e.produto_id
          INNER JOIN filiais f ON f.id = e.filial_id AND f.ativo = true
          WHERE p.estoque_minimo > 0
            AND e.saldo_atual <= p.estoque_minimo
          UNION ALL
          SELECT
            e.produto_id,
            p.codigo,
            p.descricao,
            e.filial_id,
            f.sigla AS filial_sigla,
            e.saldo_atual,
            p.estoque_minimo,
            p.estoque_maximo,
            'MAXIMO'::text AS tipo
          FROM estoques e
          INNER JOIN produtos p ON p.id = e.produto_id
          INNER JOIN filiais f ON f.id = e.filial_id AND f.ativo = true
          WHERE p.estoque_maximo > 0
            AND e.saldo_atual >= p.estoque_maximo
        ) a
        ORDER BY
          CASE WHEN a.tipo = 'MINIMO' THEN a.saldo_atual - a.estoque_minimo
               ELSE a.estoque_maximo - a.saldo_atual END ASC,
          a.codigo ASC
        LIMIT ${lim}
      `;

  return rows.map((a) => ({
    produtoId: a.produto_id,
    codigo: a.codigo,
    descricao: a.descricao,
    filialId: a.filial_id,
    filialSigla: a.filial_sigla,
    saldoAtual: Number(a.saldo_atual),
    estoqueMinimo: a.estoque_minimo,
    estoqueMaximo: a.estoque_maximo,
    tipo: a.tipo as "MINIMO" | "MAXIMO",
  }));
}

export async function obterDashboard(
  user: AuthUser,
  filialIdFiltro?: string | null
) {
  const { filialId, consolidado } = await resolveDashboardFilialScope(
    user,
    filialIdFiltro
  );

  const estoqueWhere = filialId
    ? { filialId }
    : { filial: { ativo: true } };
  const movWhere = movWhereFilial(filialId);

  const hoje = startOfDaySaoPaulo(0);
  const desde30 = startOfDaySaoPaulo(30);

  const [
    kpisEstoque,
    alertas,
    totalEstoques,
    estoques,
    pendentes,
    movimentosHoje,
    movimentos30d,
    gruposOperacao,
    transfEnviadas30d,
    filiais,
  ] = await Promise.all([
    agregarKpisEstoque(filialId),
    listarAlertas(filialId, ALERTAS_LIMITE),
    prisma.estoque.count({ where: estoqueWhere }),
    prisma.estoque.findMany({
      where: estoqueWhere,
      include: {
        produto: {
          select: {
            id: true,
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
      take: SALDOS_LIMITE,
    }),
    prisma.movimentacao.count({
      where: { status: "PENDENTE", ...movWhere },
    }),
    prisma.movimentacao.count({
      where: {
        status: "CONCLUIDO",
        dataMovimento: { gte: hoje },
        ...movWhere,
      },
    }),
    prisma.movimentacao.count({
      where: {
        status: "CONCLUIDO",
        dataMovimento: { gte: desde30 },
        ...movWhere,
      },
    }),
    // Entrada/Saída operacionais: exclui movimentos gerados pelo módulo F8
    prisma.movimentacao.groupBy({
      by: ["operacao"],
      where: {
        dataMovimento: { gte: desde30 },
        status: "CONCLUIDO",
        operacao: { in: ["ENTRADA", "SAIDA"] },
        tipo: {
          nome: { notIn: [TIPO_TRANSF_ENVIADA, TIPO_TRANSF_RECEBIDA] },
        },
        ...movWhere,
      },
      _count: { _all: true },
    }),
    prisma.movimentacao.count({
      where: {
        dataMovimento: { gte: desde30 },
        status: "CONCLUIDO",
        tipo: { nome: TIPO_TRANSF_ENVIADA },
        ...movWhere,
      },
    }),
    user.perfil === "OPERADOR"
      ? prisma.filial.findMany({
          where: { id: { in: operadorFilialIds(user) } },
          select: { id: true, nome: true, sigla: true, ativo: true },
          orderBy: { nome: "asc" },
        })
      : prisma.filial.findMany({
          where: { ativo: true },
          select: { id: true, nome: true, sigla: true, ativo: true },
          orderBy: { nome: "asc" },
        }),
  ]);

  const saldos = estoques.map((e) => {
    const saldo = Number(e.saldoAtual);
    const preco = Number(e.produto.precoUnitario);
    const min = e.produto.estoqueMinimo;
    const max = e.produto.estoqueMaximo;
    return {
      id: e.id,
      produtoId: e.produtoId,
      codigo: e.produto.codigo,
      descricao: e.produto.descricao,
      produtoAtivo: e.produto.ativo,
      categoriaId: e.produto.categoriaId,
      categoriaNome: e.produto.categoria.nome,
      filialId: e.filialId,
      filialSigla: e.filial.sigla,
      filialNome: e.filial.nome,
      saldoAtual: saldo,
      estoqueMinimo: min,
      estoqueMaximo: max,
      precoUnitario: preco,
      valor: saldo * preco,
      abaixoMinimo: isAbaixoMinimo(saldo, min),
      acimaMaximo: isAcimaMaximo(saldo, max),
      atualizadoEm: e.atualizadoEm,
    };
  });

  const porOperacao30d: Record<string, number> = {
    ENTRADA: 0,
    SAIDA: 0,
    TRANSFERENCIA: transfEnviadas30d,
  };
  for (const g of gruposOperacao) {
    if (g.operacao === "ENTRADA" || g.operacao === "SAIDA") {
      porOperacao30d[g.operacao] = g._count._all;
    }
  }

  const alertasTotal =
    kpisEstoque.alertasMinimo + kpisEstoque.alertasMaximo;

  return {
    escopo: {
      perfil: user.perfil,
      filialId,
      consolidado,
      timezone: TZ,
    },
    kpis: {
      posicoesComSaldo: kpisEstoque.posicoesComSaldo,
      skusComSaldo: kpisEstoque.skusComSaldo,
      quantidadeTotal: kpisEstoque.quantidadeTotal,
      valorTotal: kpisEstoque.valorTotal,
      alertasMinimo: kpisEstoque.alertasMinimo,
      alertasMaximo: kpisEstoque.alertasMaximo,
      alertasEstoque: alertasTotal,
      pendentes,
      movimentosHoje,
      movimentos30d,
    },
    porOperacao30d,
    alertas,
    alertasMeta: {
      total: alertasTotal,
      retornados: alertas.length,
      truncado: alertasTotal > ALERTAS_LIMITE,
      limite: ALERTAS_LIMITE,
    },
    saldos,
    saldosMeta: {
      total: totalEstoques,
      retornados: saldos.length,
      truncado: totalEstoques > SALDOS_LIMITE,
      limite: SALDOS_LIMITE,
    },
    filiais,
  };
}
