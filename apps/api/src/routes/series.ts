import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  authenticate,
  requireFilialOperador,
  AuthedRequest,
} from "../middleware/auth";
import { AppError } from "../middleware/error";
import { operadorFilialIds } from "../lib/filialScope";

export const seriesRouter = Router();

seriesRouter.use(authenticate, requireFilialOperador);

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
      take: 50,
    });

    if (req.user!.perfil === "OPERADOR") {
      const ids = operadorFilialIds(req.user!);
      res.json(
        rows.filter(
          (r) =>
            r.status !== "EM_ESTOQUE" ||
            (r.filialId && ids.includes(r.filialId))
        )
      );
      return;
    }

    res.json(rows);
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
