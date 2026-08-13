import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  createMovimentacaoSchema,
  initEstoqueSchema,
  rejeitarMovimentacaoSchema,
  estornarMovimentacaoSchema,
  anexarMovimentacaoSchema,
} from "@teep/shared";
import { prisma } from "../lib/prisma";
import {
  authenticate,
  requireFilialOperador,
  requirePerfil,
  AuthedRequest,
} from "../middleware/auth";
import { requirePermissao } from "../middleware/permissoes";
import { validateBody, AppError } from "../middleware/error";
import { requireEstoqueParaOperar } from "../lib/estoqueGate";
import {
  criarMovimentacao,
  inicializarEstoque,
  aprovarMovimentacao,
  rejeitarMovimentacao,
  estornarMovimentacao,
  listarSaidasAbertas,
  anexarTermoComodato,
} from "../services/movimentacaoService";
import { mapaQtyOcupadaPorSaidas } from "../services/retornoVinculoHelper";
import { obterDashboard } from "../services/dashboardService";
import {
  exportarSaldosExcel,
  exportarSaldosPdf,
} from "../services/saldosExportService";
import {
  buildMovimentacoesWhere,
  exportarMovimentacoesExcel,
  exportarMovimentacoesPdf,
  parseMovimentacoesFiltroQuery,
  parseDiaCivilSaoPaulo,
} from "../services/movimentacoesExportService";
import {
  assertOperadorPodeFilial,
  operadorFilialIds,
  resolveOperadorFilialId,
} from "../lib/filialScope";
import { qtyReservadaTransferenciaPendente } from "../services/estoqueService";

export const estoqueRouter = Router();
estoqueRouter.use(authenticate, requireFilialOperador, requireEstoqueParaOperar);

estoqueRouter.get(
  "/dashboard",
  requirePermissao("dashboard"),
  async (req: AuthedRequest, res, next) => {
  try {
    const filialId = req.query.filialId
      ? String(req.query.filialId)
      : undefined;
    const data = await obterDashboard(req.user!, filialId);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

function parseSaldosExportQuery(req: AuthedRequest) {
  const rawIds = String(req.query.ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const alertaRaw = String(req.query.alerta || "").trim().toLowerCase();
  const alerta =
    alertaRaw === "min" || alertaRaw === "max" || alertaRaw === "qualquer"
      ? (alertaRaw as "min" | "max" | "qualquer")
      : undefined;
  return {
    filialId: req.query.filialId ? String(req.query.filialId) : undefined,
    q: req.query.q ? String(req.query.q) : undefined,
    categoriaId: req.query.categoriaId
      ? String(req.query.categoriaId)
      : undefined,
    soAlertas:
      req.query.soAlertas === "1" ||
      req.query.soAlertas === "true" ||
      req.query.soAlertas === "yes",
    alerta,
    ids: rawIds.length > 0 ? rawIds : undefined,
  };
}

estoqueRouter.get(
  "/dashboard/saldos/export.pdf",
  requirePermissao("dashboard"),
  async (req: AuthedRequest, res, next) => {
    try {
      const { buffer, filename } = await exportarSaldosPdf(
        req.user!,
        parseSaldosExportQuery(req)
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.send(buffer);
    } catch (e) {
      next(e);
    }
  }
);

estoqueRouter.get(
  "/dashboard/saldos/export.xlsx",
  requirePermissao("dashboard"),
  async (req: AuthedRequest, res, next) => {
    try {
      const { buffer, filename } = await exportarSaldosExcel(
        req.user!,
        parseSaldosExportQuery(req)
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.send(buffer);
    } catch (e) {
      next(e);
    }
  }
);

estoqueRouter.get(
  "/estoques",
  requirePermissao("dashboard", "estoque_init", "lancamentos"),
  async (req: AuthedRequest, res, next) => {
  try {
    let filialId = String(req.query.filialId || "");
    if (req.user!.perfil === "OPERADOR") {
      const ids = operadorFilialIds(req.user!);
      if (filialId) {
        assertOperadorPodeFilial(req.user!, filialId);
      } else if (ids.length === 1) {
        filialId = ids[0]!;
      } else {
        // multi: lista consolidada das filiais do operador
        const whereMulti: Record<string, unknown> = {
          filialId: { in: ids },
        };
        const q = String(req.query.q || "").trim();
        if (q) {
          whereMulti.produto = {
            OR: [
              { codigo: { contains: q, mode: "insensitive" } },
              { descricao: { contains: q, mode: "insensitive" } },
            ],
          };
        }
        const take = Math.min(
          2000,
          Math.max(1, Number(req.query.limit) || 500)
        );
        const [total, data] = await Promise.all([
          prisma.estoque.count({ where: whereMulti }),
          prisma.estoque.findMany({
            where: whereMulti,
            include: {
              produto: { include: { categoria: true } },
              filial: true,
            },
            orderBy: [
              { filial: { sigla: "asc" } },
              { produto: { codigo: "asc" } },
            ],
            take,
          }),
        ]);
        return res.json({ data, total, take, truncado: total > take });
      }
    } else if (filialId) {
      const ok = await prisma.filial.findFirst({
        where: { id: filialId, ativo: true },
      });
      if (!ok) throw new AppError(400, "Filial inválida ou inativa");
    }

    const where: Record<string, unknown> = {};
    if (filialId) {
      where.filialId = filialId;
    } else if (req.user!.perfil !== "OPERADOR") {
      // Consolidado Admin/Gerente: não misturar estoque de filial inativa
      where.filial = { ativo: true };
    }

    const q = String(req.query.q || "").trim();
    if (q) {
      where.produto = {
        OR: [
          { codigo: { contains: q, mode: "insensitive" } },
          { descricao: { contains: q, mode: "insensitive" } },
        ],
      };
    }

    const take = Math.min(
      2000,
      Math.max(1, Number(req.query.limit) || 500)
    );

    const [total, data] = await Promise.all([
      prisma.estoque.count({ where }),
      prisma.estoque.findMany({
        where,
        include: {
          produto: { include: { categoria: true } },
          filial: true,
        },
        orderBy: [{ filial: { sigla: "asc" } }, { produto: { codigo: "asc" } }],
        take,
      }),
    ]);

    res.json({ data, total, take, truncado: total > take });
  } catch (e) {
    next(e);
  }
});

/** Saldo pontual produto×filial (leitura p/ lançamento — origem e destino). */
estoqueRouter.get(
  "/estoques/saldo",
  requirePermissao("lancamentos", "dashboard", "estoque_init"),
  async (req: AuthedRequest, res, next) => {
    try {
      const produtoId = String(req.query.produtoId || "");
      const filialId = String(req.query.filialId || "");
      if (!produtoId || !filialId) {
        throw new AppError(400, "produtoId e filialId obrigatórios");
      }
      const filial = await prisma.filial.findFirst({
        where: { id: filialId, ativo: true },
        select: { id: true, sigla: true },
      });
      if (!filial) throw new AppError(400, "Filial inválida ou inativa");
      // OPERADOR pode consultar saldo de destino na transferência (qualquer filial ativa),
      // desde que tenha ao menos uma filial vinculada.
      if (req.user!.perfil === "OPERADOR") {
        const ids = operadorFilialIds(req.user!);
        if (ids.length === 0) {
          throw new AppError(403, "Operador sem filial");
        }
      }
      const produto = await prisma.produto.findFirst({
        where: { id: produtoId, ativo: true },
        select: { id: true },
      });
      if (!produto) throw new AppError(404, "Produto não encontrado");

      const row = await prisma.estoque.findUnique({
        where: {
          uniq_produto_filial: { produtoId, filialId },
        },
        select: { saldoAtual: true },
      });
      const saldoAtual = row ? Number(row.saldoAtual) : 0;
      const reservadoPendente = await qtyReservadaTransferenciaPendente(
        prisma,
        produtoId,
        filialId
      );
      const disponivel = Math.max(0, saldoAtual - reservadoPendente);
      res.json({
        produtoId,
        filialId,
        filialSigla: filial.sigla,
        saldoAtual,
        reservadoPendente,
        disponivel,
      });
    } catch (e) {
      next(e);
    }
  }
);

estoqueRouter.post(
  "/estoques/inicializacao",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("estoque_init"),
  validateBody(initEstoqueSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await inicializarEstoque(req.user!, req.body);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);

estoqueRouter.get(
  "/estoques/alertas-minimo",
  requirePermissao("dashboard"),
  async (req: AuthedRequest, res, next) => {
  try {
    let filialId =
      req.user!.perfil === "OPERADOR"
        ? resolveOperadorFilialId(
            req.user!,
            req.query.filialId ? String(req.query.filialId) : null
          )
        : String(req.query.filialId || "");

    if (req.user!.perfil !== "OPERADOR" && filialId) {
      const ok = await prisma.filial.findFirst({
        where: { id: filialId, ativo: true },
      });
      if (!ok) throw new AppError(400, "Filial inválida ou inativa");
    }

    const take = Math.min(
      2000,
      Math.max(1, Number(req.query.limit) || 500)
    );
    const lim = Prisma.raw(String(take));

    type Row = {
      id: string;
      produto_id: string;
      filial_id: string;
      saldo_atual: unknown;
      codigo: string;
      descricao: string;
      estoque_minimo: number;
      filial_sigla: string;
      filial_nome: string;
    };

    const rows = filialId
      ? await prisma.$queryRaw<Row[]>`
          SELECT
            e.id,
            e.produto_id,
            e.filial_id,
            e.saldo_atual,
            p.codigo,
            p.descricao,
            p.estoque_minimo,
            f.sigla AS filial_sigla,
            f.nome AS filial_nome
          FROM estoques e
          INNER JOIN produtos p ON p.id = e.produto_id
          INNER JOIN filiais f ON f.id = e.filial_id
          WHERE e.filial_id = ${filialId}::uuid
            AND p.estoque_minimo > 0
            AND e.saldo_atual <= p.estoque_minimo
          ORDER BY (e.saldo_atual - p.estoque_minimo) ASC, p.codigo ASC
          LIMIT ${lim}
        `
      : await prisma.$queryRaw<Row[]>`
          SELECT
            e.id,
            e.produto_id,
            e.filial_id,
            e.saldo_atual,
            p.codigo,
            p.descricao,
            p.estoque_minimo,
            f.sigla AS filial_sigla,
            f.nome AS filial_nome
          FROM estoques e
          INNER JOIN produtos p ON p.id = e.produto_id
          INNER JOIN filiais f ON f.id = e.filial_id AND f.ativo = true
          WHERE p.estoque_minimo > 0
            AND e.saldo_atual <= p.estoque_minimo
          ORDER BY (e.saldo_atual - p.estoque_minimo) ASC, p.codigo ASC
          LIMIT ${lim}
        `;

    const countRows = filialId
      ? await prisma.$queryRaw<Array<{ n: number }>>`
          SELECT COUNT(*)::int AS n
          FROM estoques e
          INNER JOIN produtos p ON p.id = e.produto_id
          WHERE e.filial_id = ${filialId}::uuid
            AND p.estoque_minimo > 0
            AND e.saldo_atual <= p.estoque_minimo
        `
      : await prisma.$queryRaw<Array<{ n: number }>>`
          SELECT COUNT(*)::int AS n
          FROM estoques e
          INNER JOIN produtos p ON p.id = e.produto_id
          INNER JOIN filiais f ON f.id = e.filial_id AND f.ativo = true
          WHERE p.estoque_minimo > 0
            AND e.saldo_atual <= p.estoque_minimo
        `;

    const total = Number(countRows[0]?.n ?? 0);
    const data = rows.map((r) => ({
      id: r.id,
      produtoId: r.produto_id,
      filialId: r.filial_id,
      saldoAtual: Number(r.saldo_atual),
      estoqueMinimo: r.estoque_minimo,
      produto: {
        codigo: r.codigo,
        descricao: r.descricao,
        estoqueMinimo: r.estoque_minimo,
      },
      filial: { sigla: r.filial_sigla, nome: r.filial_nome },
    }));

    res.json({ data, total, take, truncado: total > data.length });
  } catch (e) {
    next(e);
  }
});

estoqueRouter.get(
  "/movimentacoes",
  requirePermissao("movimentacoes", "aprovacoes"),
  async (req: AuthedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const where = buildMovimentacoesWhere(
      req.user!,
      parseMovimentacoesFiltroQuery(req.query as Record<string, unknown>)
    );

    const [total, data] = await Promise.all([
      prisma.movimentacao.count({ where }),
      prisma.movimentacao.findMany({
        where,
        include: {
          produto: true,
          tipo: true,
          filial: true,
          filialDestino: true,
          cliente: true,
          usuario: { select: { id: true, nome: true } },
          anexos: { select: { id: true, tipo: true, arquivo: true, label: true } },
          series: {
            include: {
              unidadeSerie: {
                select: { id: true, numeroSerie: true, status: true },
              },
            },
          },
        },
        orderBy: { dataMovimento: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    /** Saídas demo/comodato (geraAlertaRetorno) ainda com qty em aberto → CTA de retorno. */
    const candidatas = data.filter(
      (m) =>
        m.operacao === "SAIDA" &&
        m.status === "CONCLUIDO" &&
        !m.estornoDeId &&
        m.clienteId &&
        m.tipo.geraAlertaRetorno
    );
    const ocupadaMap = await mapaQtyOcupadaPorSaidas(
      prisma,
      candidatas.map((m) => m.id)
    );
    const tipoOrigemIds = [...new Set(candidatas.map((m) => m.tipoId))];
    const tiposRetorno =
      tipoOrigemIds.length > 0
        ? await prisma.tipoMovimentacao.findMany({
            where: {
              ativo: true,
              ehRetornoDeId: { in: tipoOrigemIds },
            },
            select: { id: true, nome: true, ehRetornoDeId: true },
          })
        : [];
    const retornoPorOrigem = new Map(
      tiposRetorno
        .filter((t) => t.ehRetornoDeId)
        .map((t) => [t.ehRetornoDeId!, t])
    );

    /** Itens de transferência nas linhas da página → badge A→B, anexos da carga, CTA receber. */
    const itemIdsTransf = [
      ...new Set(
        data
          .filter((m) => m.transferenciaItemId)
          .map((m) => m.transferenciaItemId as string)
      ),
    ];
    const itensTransf =
      itemIdsTransf.length > 0
        ? await prisma.transferenciaItem.findMany({
            where: { id: { in: itemIdsTransf } },
            select: {
              id: true,
              transferenciaId: true,
              transferencia: {
                select: {
                  status: true,
                  destinoFilialId: true,
                  notaFiscalNumero: true,
                  anexos: {
                    select: {
                      id: true,
                      tipo: true,
                      arquivo: true,
                      label: true,
                    },
                    orderBy: { criadoEm: "asc" },
                  },
                },
              },
            },
          })
        : [];
    const cargaPorItem = new Map(
      itensTransf.map((i) => [
        i.id,
        {
          transferenciaId: i.transferenciaId,
          destinoFilialId: i.transferencia.destinoFilialId,
          status: i.transferencia.status,
          notaFiscalNumero: i.transferencia.notaFiscalNumero,
          anexos: i.transferencia.anexos,
        },
      ])
    );
    const aguardandoPorItem = new Map(
      [...cargaPorItem.entries()]
        .filter(([, c]) => c.status === "EM_TRANSITO")
        .map(([itemId, c]) => [
          itemId,
          {
            transferenciaId: c.transferenciaId,
            destinoFilialId: c.destinoFilialId,
          },
        ])
    );

    const enriched = data.map((m) => {
      const termoPendente =
        m.operacao === "SAIDA" &&
        m.status === "CONCLUIDO" &&
        !m.estornoDeId &&
        m.tipo.requerTermoComodato &&
        !m.anexos.some((a) => a.tipo === "TERMO_COMODATO");

      const aguardandoRecebimento =
        m.transferenciaItemId &&
        m.operacao === "SAIDA" &&
        m.status === "CONCLUIDO" &&
        !m.estornoDeId
          ? aguardandoPorItem.get(m.transferenciaItemId) || null
          : null;

      const carga = m.transferenciaItemId
        ? cargaPorItem.get(m.transferenciaItemId) || null
        : null;

      const base = {
        ...m,
        termoPendente,
        aguardandoRecebimento,
        transferenciaId: carga?.transferenciaId ?? null,
        transferenciaNotaFiscalNumero: carga?.notaFiscalNumero ?? null,
        transferenciaAnexos: carga?.anexos ?? [],
      };

      if (
        m.operacao !== "SAIDA" ||
        m.status !== "CONCLUIDO" ||
        m.estornoDeId ||
        !m.clienteId ||
        !m.tipo.geraAlertaRetorno
      ) {
        return { ...base, retornoPendente: null };
      }
      const tipoRetorno = retornoPorOrigem.get(m.tipoId);
      if (!tipoRetorno) return { ...base, retornoPendente: null };
      const qty = Number(m.quantidade);
      const qtyRestante = Math.max(0, qty - (ocupadaMap.get(m.id) || 0));
      if (qtyRestante <= 1e-9) {
        return { ...base, retornoPendente: null };
      }
      return {
        ...base,
        retornoPendente: {
          qtyRestante,
          tipoRetornoId: tipoRetorno.id,
          tipoRetornoNome: tipoRetorno.nome,
        },
      };
    });

    res.json({ data: enriched, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

estoqueRouter.get(
  "/movimentacoes/export.pdf",
  requirePermissao("movimentacoes", "aprovacoes"),
  async (req: AuthedRequest, res, next) => {
    try {
      const { buffer, filename } = await exportarMovimentacoesPdf(
        req.user!,
        parseMovimentacoesFiltroQuery(req.query as Record<string, unknown>)
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.send(buffer);
    } catch (e) {
      next(e);
    }
  }
);

estoqueRouter.get(
  "/movimentacoes/export.xlsx",
  requirePermissao("movimentacoes", "aprovacoes"),
  async (req: AuthedRequest, res, next) => {
    try {
      const { buffer, filename } = await exportarMovimentacoesExcel(
        req.user!,
        parseMovimentacoesFiltroQuery(req.query as Record<string, unknown>)
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.send(buffer);
    } catch (e) {
      next(e);
    }
  }
);

/** Resumo do produto no período (independente do filtro de tipo da lista). */
estoqueRouter.get(
  "/movimentacoes/resumo",
  requirePermissao("movimentacoes", "aprovacoes"),
  async (req: AuthedRequest, res, next) => {
    try {
      const produtoId = String(req.query.produtoId || "").trim();
      if (!produtoId) {
        throw new AppError(400, "produtoId obrigatório");
      }

      const produto = await prisma.produto.findUnique({
        where: { id: produtoId },
        select: { id: true, codigo: true, descricao: true, unidade: true },
      });
      if (!produto) throw new AppError(404, "Produto não encontrado");

      let filialIds: string[] | null = null;
      const filialIdQ = String(req.query.filialId || "").trim();
      if (req.user!.perfil === "OPERADOR") {
        const ids = operadorFilialIds(req.user!);
        if (filialIdQ) {
          assertOperadorPodeFilial(req.user!, filialIdQ);
          filialIds = [filialIdQ];
        } else {
          filialIds = ids;
        }
      } else if (filialIdQ) {
        const ok = await prisma.filial.findFirst({
          where: { id: filialIdQ, ativo: true },
          select: { id: true },
        });
        if (!ok) throw new AppError(400, "Filial inválida ou inativa");
        filialIds = [filialIdQ];
      } else {
        filialIds = null; // consolidado filiais ativas
      }

      const dataInicio = String(req.query.dataInicio || "").trim();
      const dataFim = String(req.query.dataFim || "").trim();
      const range: { gte?: Date; lte?: Date } = {};
      if (dataInicio) {
        const d = parseDiaCivilSaoPaulo(dataInicio, "inicio");
        if (d) range.gte = d;
      }
      if (dataFim) {
        const d = parseDiaCivilSaoPaulo(dataFim, "fim");
        if (d) range.lte = d;
      }

      const movWhere: Record<string, unknown> = {
        produtoId,
        status: "CONCLUIDO",
        operacao: { in: ["ENTRADA", "SAIDA"] },
      };
      if (filialIds) {
        movWhere.filialId = { in: filialIds };
      } else {
        movWhere.filial = { ativo: true };
      }
      if (range.gte || range.lte) {
        movWhere.dataMovimento = range;
      }

      const grouped = await prisma.movimentacao.groupBy({
        by: ["operacao"],
        where: movWhere,
        _sum: { quantidade: true },
      });

      let entradas = 0;
      let saidas = 0;
      for (const g of grouped) {
        const q = Number(g._sum.quantidade ?? 0);
        if (g.operacao === "ENTRADA") entradas = q;
        if (g.operacao === "SAIDA") saidas = q;
      }
      const diferenca = Math.round((entradas - saidas) * 10000) / 10000;

      const estoqueWhere: Record<string, unknown> = { produtoId };
      if (filialIds) {
        estoqueWhere.filialId = { in: filialIds };
      } else {
        estoqueWhere.filial = { ativo: true };
      }
      const estoques = await prisma.estoque.findMany({
        where: estoqueWhere,
        select: { saldoAtual: true },
      });
      const estoqueAtual =
        Math.round(
          estoques.reduce((s, e) => s + Number(e.saldoAtual), 0) * 10000
        ) / 10000;

      res.json({
        produto,
        dataInicio: dataInicio || null,
        dataFim: dataFim || null,
        filialIds,
        entradas,
        saidas,
        diferenca,
        estoqueAtual,
        unidade: produto.unidade,
      });
    } catch (e) {
      next(e);
    }
  }
);

// Rota estática ANTES de /:id — senão "saidas-abertas" é capturado como id.
estoqueRouter.get(
  "/movimentacoes/saidas-abertas",
  requirePermissao("lancamentos"),
  async (req: AuthedRequest, res, next) => {
    try {
      const tipoOrigemId = String(req.query.tipoOrigemId || "");
      const clienteId = String(req.query.clienteId || "");
      if (!tipoOrigemId || !clienteId) {
        throw new AppError(400, "tipoOrigemId e clienteId obrigatórios");
      }
      const UUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID.test(tipoOrigemId) || !UUID.test(clienteId)) {
        throw new AppError(400, "Parâmetros inválidos");
      }
      const opIds =
        req.user!.perfil === "OPERADOR"
          ? operadorFilialIds(req.user!)
          : null;
      res.json(
        await listarSaidasAbertas({
          tipoOrigemId,
          clienteId,
          filialIdsPermitidas: opIds,
        })
      );
    } catch (e) {
      next(e);
    }
  }
);

estoqueRouter.get(
  "/movimentacoes/:id",
  requirePermissao("movimentacoes", "aprovacoes", "lancamentos"),
  async (req: AuthedRequest, res, next) => {
  try {
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID.test(req.params.id)) {
      throw new AppError(404, "Movimentação não encontrada");
    }
    const mov = await prisma.movimentacao.findUnique({
      where: { id: req.params.id },
      include: {
        produto: true,
        tipo: true,
        filial: true,
        filialDestino: true,
        cliente: true,
        usuario: { select: { id: true, nome: true, email: true } },
        series: {
          include: {
            unidadeSerie: {
              select: { id: true, numeroSerie: true, status: true },
            },
          },
        },
      },
    });
    if (!mov) throw new AppError(404, "Movimentação não encontrada");
    if (req.user!.perfil === "OPERADOR") {
      const ids = operadorFilialIds(req.user!);
      const ok =
        ids.includes(mov.filialId) ||
        (mov.filialDestinoId && ids.includes(mov.filialDestinoId));
      if (!ok) throw new AppError(403, "Acesso negado");
    }
    res.json(mov);
  } catch (e) {
    next(e);
  }
});

estoqueRouter.post(
  "/movimentacoes",
  requirePermissao("lancamentos"),
  validateBody(createMovimentacaoSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await criarMovimentacao(req.user!, req.body);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);

estoqueRouter.post(
  "/movimentacoes/:id/aprovar",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("aprovacoes"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await aprovarMovimentacao(req.user!, req.params.id);
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

estoqueRouter.post(
  "/movimentacoes/:id/rejeitar",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("aprovacoes"),
  validateBody(rejeitarMovimentacaoSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await rejeitarMovimentacao(
        req.user!,
        req.params.id,
        req.body.motivo
      );
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

estoqueRouter.post(
  "/movimentacoes/:id/anexos",
  requirePermissao("lancamentos", "movimentacoes"),
  validateBody(anexarMovimentacaoSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const UUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID.test(req.params.id)) {
        throw new AppError(404, "Movimentação não encontrada");
      }
      if (req.user!.perfil === "OPERADOR") {
        const mov = await prisma.movimentacao.findUnique({
          where: { id: req.params.id },
          select: { filialId: true },
        });
        if (!mov) throw new AppError(404, "Movimentação não encontrada");
        assertOperadorPodeFilial(req.user!, mov.filialId);
      }
      const anexo = await anexarTermoComodato(req.user!, req.params.id, {
        arquivo: req.body.arquivo,
        label: req.body.label,
      });
      res.status(201).json(anexo);
    } catch (e) {
      next(e);
    }
  }
);

estoqueRouter.post(
  "/movimentacoes/:id/estornar",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("aprovacoes"),
  validateBody(estornarMovimentacaoSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await estornarMovimentacao(
        req.user!,
        req.params.id,
        req.body.observacao
      );
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);
