import { Router } from "express";
import {
  alocarSeriesSchema,
  desfazerAlocacaoSerieSchema,
} from "@teep/shared";
import { prisma } from "../lib/prisma";
import {
  authenticate,
  requireFilialOperador,
  AuthedRequest,
} from "../middleware/auth";
import { AppError, validateBody } from "../middleware/error";
import { operadorFilialIds } from "../lib/filialScope";
import { requireEstoqueParaOperar } from "../lib/estoqueGate";
import {
  alocarSeriesProduto,
  consultarContadorSerie,
  desfazerAlocacaoSerie,
} from "../services/geracaoSerieService";

export const seriesRouter = Router();

seriesRouter.use(authenticate, requireFilialOperador, requireEstoqueParaOperar);

const BUSCA_LIMIT = 50;

/** Busca unidades por número de série (parcial). */
seriesRouter.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      throw new AppError(400, "Informe ao menos 2 caracteres em q");
    }
    const produtoId = req.query.produtoId
      ? String(req.query.produtoId)
      : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const filialId = req.query.filialId
      ? String(req.query.filialId)
      : undefined;

    const rows = await prisma.unidadeSerie.findMany({
      where: {
        numeroSerie: { contains: q, mode: "insensitive" },
        ...(produtoId ? { produtoId } : {}),
        ...(status ? { status } : {}),
        ...(filialId ? { filialId } : {}),
      },
      include: {
        produto: {
          select: {
            id: true,
            codigo: true,
            descricao: true,
            controlaSerie: true,
          },
        },
        filial: { select: { id: true, nome: true, sigla: true } },
        cliente: { select: { id: true, nome: true } },
      },
      orderBy: { numeroSerie: "asc" },
      take: BUSCA_LIMIT + 1,
    });

    let data = rows;
    if (req.user!.perfil === "OPERADOR") {
      const ids = operadorFilialIds(req.user!);
      data = rows.filter(
        (r) =>
          r.status !== "EM_ESTOQUE" ||
          (r.filialId && ids.includes(r.filialId))
      );
    }

    const truncado = data.length > BUSCA_LIMIT;
    res.json({
      data: truncado ? data.slice(0, BUSCA_LIMIT) : data,
      truncado,
    });
  } catch (e) {
    next(e);
  }
});

/** Séries disponíveis (EM_ESTOQUE) de um produto numa filial. */
seriesRouter.get("/disponiveis", async (req: AuthedRequest, res, next) => {
  try {
    const produtoId = String(req.query.produtoId || "");
    const filialId = String(req.query.filialId || "");
    if (!produtoId || !filialId) {
      throw new AppError(400, "produtoId e filialId obrigatórios");
    }
    if (req.user!.perfil === "OPERADOR") {
      const ids = operadorFilialIds(req.user!);
      if (!ids.includes(filialId)) {
        throw new AppError(403, "Acesso negado a esta filial");
      }
    }
    const rows = await prisma.unidadeSerie.findMany({
      where: {
        produtoId,
        filialId,
        status: "EM_ESTOQUE",
      },
      orderBy: { numeroSerie: "asc" },
      select: {
        id: true,
        numeroSerie: true,
        status: true,
        filialId: true,
      },
    });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/**
 * Valida se um número de série está EM_ESTOQUE no produto/filial
 * (uso no Novo Lançamento — feedback live em SAÍDA/TRANSFERÊNCIA).
 */
seriesRouter.post("/validar-saida", async (req: AuthedRequest, res, next) => {
  try {
    const produtoId = String(req.body?.produtoId || "");
    const filialId = String(req.body?.filialId || "");
    const numero = String(req.body?.numero || "").trim();
    if (!produtoId || !filialId || !numero) {
      throw new AppError(400, "produtoId, filialId e numero são obrigatórios");
    }
    if (req.user!.perfil === "OPERADOR") {
      const ids = operadorFilialIds(req.user!);
      if (!ids.includes(filialId)) {
        throw new AppError(403, "Acesso negado a esta filial");
      }
    }

    const unidade = await prisma.unidadeSerie.findFirst({
      where: {
        produtoId,
        numeroSerie: { equals: numero, mode: "insensitive" },
      },
      select: {
        id: true,
        numeroSerie: true,
        status: true,
        filialId: true,
      },
    });

    const ok =
      !!unidade &&
      unidade.status === "EM_ESTOQUE" &&
      unidade.filialId === filialId;

    res.json({
      ok,
      numeroSerie: unidade?.numeroSerie ?? numero,
      status: unidade?.status ?? null,
      filialId: unidade?.filialId ?? null,
      motivo: ok
        ? null
        : !unidade
          ? "Série não cadastrada para este produto"
          : unidade.status !== "EM_ESTOQUE"
            ? `Série com status ${unidade.status}`
            : "Série não está neste estoque",
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Aloca bloco de séries no contador (não cria UnidadeSerie).
 * Use no Novo Lançamento (entrada) e confirme com a movimentação.
 */
seriesRouter.post(
  "/alocar",
  validateBody(alocarSeriesSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const out = await alocarSeriesProduto({
        ...req.body,
        usuarioId: req.user!.id,
      });
      res.status(201).json(out);
    } catch (e) {
      next(e);
    }
  }
);

/** Desfaz última alocação pendente (reverte contador se for o topo). */
seriesRouter.post(
  "/alocar/desfazer",
  validateBody(desfazerAlocacaoSerieSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const out = await desfazerAlocacaoSerie({
        alocacaoId: req.body.alocacaoId,
        usuarioId: req.user!.id,
        perfil: req.user!.perfil,
      });
      res.json(out);
    } catch (e) {
      next(e);
    }
  }
);

seriesRouter.get(
  "/contador/:produtoId",
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await consultarContadorSerie(req.params.produtoId));
    } catch (e) {
      next(e);
    }
  }
);

seriesRouter.get("/:id/historico", async (req: AuthedRequest, res, next) => {
  try {
    const unidade = await prisma.unidadeSerie.findUnique({
      where: { id: req.params.id },
      include: {
        produto: {
          select: { id: true, codigo: true, descricao: true },
        },
        filial: { select: { id: true, nome: true, sigla: true } },
        cliente: { select: { id: true, nome: true } },
      },
    });
    if (!unidade) throw new AppError(404, "Série não encontrada");

    const movs = await prisma.movimentacaoSerie.findMany({
      where: { unidadeSerieId: unidade.id },
      include: {
        movimentacao: {
          include: {
            tipo: { select: { id: true, nome: true, operacao: true } },
            filial: { select: { id: true, nome: true, sigla: true } },
            filialDestino: { select: { id: true, nome: true, sigla: true } },
            cliente: { select: { id: true, nome: true } },
            usuario: { select: { id: true, nome: true } },
          },
        },
      },
      orderBy: { movimentacao: { dataMovimento: "desc" } },
      take: 100,
    });

    res.json({
      unidade,
      historico: movs.map((m) => m.movimentacao),
    });
  } catch (e) {
    next(e);
  }
});
