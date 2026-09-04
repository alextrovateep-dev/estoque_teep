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
} from "../services/transformacaoService";
import { calcularSimulacaoArvore } from "../services/simulacaoArvoreService";

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

/** Preview: componentes da BOM do destino que serão baixados (exclui origem se estiver na árvore). */
transformacoesRouter.get(
  "/preview",
  requirePermissao("lancamentos"),
  async (req: AuthedRequest, res, next) => {
    try {
      const filialId = String(req.query.filialId || "");
      const produtoOrigemId = String(req.query.produtoOrigemId || "");
      const produtoDestinoId = String(req.query.produtoDestinoId || "");
      if (!filialId || !produtoDestinoId) {
        throw new AppError(400, "filialId e produtoDestinoId são obrigatórios");
      }
      assertOperadorPodeFilial(req.user!, filialId);
      const sim = await calcularSimulacaoArvore({
        produtoId: produtoDestinoId,
        filialId,
        quantidade: 1,
      });
      const linhas = sim.linhas.filter(
        (l) =>
          !l.fantasma &&
          (!produtoOrigemId || l.produtoFilhoId !== produtoOrigemId)
      );
      const faltantes = linhas.filter((l) => l.faltante > 0);
      res.json({
        produto: sim.produto,
        filial: sim.filial,
        linhas,
        okSaldo: faltantes.length === 0,
        faltantes: faltantes.map((l) => ({
          codigo: l.codigo,
          faltante: l.faltante,
        })),
      });
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
