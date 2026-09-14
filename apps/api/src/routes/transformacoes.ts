import { Router } from "express";
import { createTransformacaoSchema } from "@teep/shared";
import {
  authenticate,
  requireFilialOperador,
  AuthedRequest,
} from "../middleware/auth";
import { requirePermissao } from "../middleware/permissoes";
import { validateBody, AppError } from "../middleware/error";
import { requireEstoqueParaOperar } from "../lib/estoqueGate";
import { assertOperadorPodeFilial } from "../lib/filialScope";
import {
  criarTransformacao,
  listarTransformacoes,
  previewTransformacao,
} from "../services/transformacaoService";

export const transformacoesRouter = Router();

transformacoesRouter.use(
  authenticate,
  requireFilialOperador,
  requireEstoqueParaOperar
);

transformacoesRouter.get(
  "/",
  requirePermissao("lancamentos"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await listarTransformacoes(req.user!, {
        filialId: req.query.filialId
          ? String(req.query.filialId)
          : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 20,
      });
      res.json(data);
    } catch (e) {
      next(e);
    }
  }
);

/** Preview: diff BOM A→B — exige origem e destino. */
transformacoesRouter.get(
  "/preview",
  requirePermissao("lancamentos"),
  async (req: AuthedRequest, res, next) => {
    try {
      const filialId = String(req.query.filialId || "");
      const produtoOrigemId = String(req.query.produtoOrigemId || "");
      const produtoDestinoId = String(req.query.produtoDestinoId || "");
      if (!filialId || !produtoOrigemId || !produtoDestinoId) {
        throw new AppError(
          400,
          "filialId, produtoOrigemId e produtoDestinoId são obrigatórios"
        );
      }
      assertOperadorPodeFilial(req.user!, filialId);
      res.json(
        await previewTransformacao({
          filialId,
          produtoDestinoId,
          produtoOrigemId,
        })
      );
    } catch (e) {
      next(e);
    }
  }
);

transformacoesRouter.post(
  "/",
  requirePermissao("lancamentos"),
  validateBody(createTransformacaoSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const out = await criarTransformacao(req.user!, req.body);
      res.status(201).json(out);
    } catch (e) {
      next(e);
    }
  }
);
