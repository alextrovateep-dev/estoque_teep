import { Router } from "express";
import {
  anexarRmaSchema,
  createRmaProcessoSchema,
  devolverRmaSchema,
  semManutencaoRmaSchema,
  trocarRmaItemSchema,
  updateRmaFinanceiroSchema,
} from "@teep/shared";
import {
  authenticate,
  requireFilialOperador,
  AuthedRequest,
} from "../middleware/auth";
import { requirePermissao, loadPermissoes } from "../middleware/permissoes";
import { validateBody } from "../middleware/error";
import {
  anexarRma,
  atualizarRmaFinanceiro,
  cancelarRma,
  criarRmaProcesso,
  devolverRmaItens,
  listarRma,
  marcarSemManutencaoRma,
  obterRma,
  trocarRmaItem,
} from "../services/rmaService";
import { resolveRmaDefaults } from "../lib/rmaDefaults";
import { requireEstoqueParaOperar } from "../lib/estoqueGate";

export const rmaRouter = Router();
rmaRouter.use(authenticate, requireFilialOperador, requireEstoqueParaOperar);

rmaRouter.get("/", requirePermissao("rma"), async (req: AuthedRequest, res, next) => {
  try {
    res.json(
      await listarRma(req.user!, {
        status: String(req.query.status || "").trim() || undefined,
        clienteId: String(req.query.clienteId || "").trim() || undefined,
        cobrou: String(req.query.cobrou || "").trim() || undefined,
        dataInicio: String(req.query.dataInicio || "").trim() || undefined,
        dataFim: String(req.query.dataFim || "").trim() || undefined,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 20,
      })
    );
  } catch (e) {
    next(e);
  }
});

/** Defaults de filiais RMA (env + fallback por sigla). */
rmaRouter.get(
  "/defaults",
  requirePermissao("rma"),
  async (_req, res, next) => {
    try {
      res.json(await resolveRmaDefaults());
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.post(
  "/",
  requirePermissao("rma"),
  validateBody(createRmaProcessoSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const row = await criarRmaProcesso(req.user!, req.body);
      res.status(201).json(row);
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.get(
  "/:id",
  requirePermissao("rma"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await obterRma(req.user!, req.params.id));
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.patch(
  "/:id/financeiro",
  requirePermissao("rma_cobranca"),
  validateBody(updateRmaFinanceiroSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await atualizarRmaFinanceiro(req.user!, req.params.id, req.body));
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.post(
  "/:id/anexos",
  requirePermissao("rma", "rma_cobranca"),
  validateBody(anexarRmaSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const perms = await loadPermissoes(req);
      const podeFinanceiro = Boolean(perms.rma_cobranca);
      res.json(
        await anexarRma(req.user!, req.params.id, req.body, { podeFinanceiro })
      );
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.post(
  "/:id/devolver",
  requirePermissao("rma"),
  validateBody(devolverRmaSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await devolverRmaItens(req.user!, req.params.id, req.body));
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.post(
  "/:id/sem-manutencao",
  requirePermissao("rma"),
  validateBody(semManutencaoRmaSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await marcarSemManutencaoRma(req.user!, req.params.id, req.body));
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.post(
  "/:id/trocar",
  requirePermissao("rma"),
  validateBody(trocarRmaItemSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await trocarRmaItem(req.user!, req.params.id, req.body));
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.post(
  "/:id/cancelar",
  requirePermissao("rma"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await cancelarRma(req.user!, req.params.id));
    } catch (e) {
      next(e);
    }
  }
);
