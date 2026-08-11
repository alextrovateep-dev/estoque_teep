import { Router } from "express";
import {
  createTransferenciaSchema,
  conferirTransferenciaSchema,
  rejeitarMovimentacaoSchema,
} from "@teep/shared";
import {
  authenticate,
  requireFilialOperador,
  requirePerfil,
  AuthedRequest,
} from "../middleware/auth";
import { requirePermissao } from "../middleware/permissoes";
import { validateBody } from "../middleware/error";
import { requireEstoqueParaOperar } from "../lib/estoqueGate";
import {
  listarTransferencias,
  obterTransferencia,
  criarTransferenciaViaApiLegada,
  conferirTransferencia,
  cancelarTransferencia,
  aprovarTransferencia,
  rejeitarTransferencia,
  listarTransferenciasPendentesAprovacao,
  contarTransferenciasPendentesAprovacao,
} from "../services/transferenciaService";

export const transferenciasRouter = Router();
transferenciasRouter.use(
  authenticate,
  requireFilialOperador,
  requireEstoqueParaOperar
);

transferenciasRouter.get(
  "/",
  requirePermissao("transferencias"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await listarTransferencias(req.user!));
    } catch (e) {
      next(e);
    }
  }
);

transferenciasRouter.get(
  "/pendentes-aprovacao",
  requirePermissao("aprovacoes"),
  async (_req: AuthedRequest, res, next) => {
    try {
      const [data, total] = await Promise.all([
        listarTransferenciasPendentesAprovacao(),
        contarTransferenciasPendentesAprovacao(),
      ]);
      res.json({ data, total });
    } catch (e) {
      next(e);
    }
  }
);

transferenciasRouter.get(
  "/pendentes-aprovacao/count",
  requirePermissao("aprovacoes"),
  async (_req: AuthedRequest, res, next) => {
    try {
      res.json({ total: await contarTransferenciasPendentesAprovacao() });
    } catch (e) {
      next(e);
    }
  }
);

transferenciasRouter.get(
  "/:id",
  requirePermissao("transferencias"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await obterTransferencia(req.user!, req.params.id));
    } catch (e) {
      next(e);
    }
  }
);

transferenciasRouter.post(
  "/",
  requirePermissao("transferencias"),
  validateBody(createTransferenciaSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      // F15: UI cria via POST /movimentacoes; este endpoint respeita requerAprovacao.
      const result = await criarTransferenciaViaApiLegada(req.user!, req.body);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);

transferenciasRouter.post(
  "/:id/conferir",
  requirePermissao("transferencias"),
  validateBody(conferirTransferenciaSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await conferirTransferencia(
        req.user!,
        req.params.id,
        req.body
      );
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

transferenciasRouter.post(
  "/:id/cancelar",
  requirePermissao("aprovacoes"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await cancelarTransferencia(req.user!, req.params.id);
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

transferenciasRouter.post(
  "/:id/aprovar",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("aprovacoes"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await aprovarTransferencia(req.user!, req.params.id));
    } catch (e) {
      next(e);
    }
  }
);

transferenciasRouter.post(
  "/:id/rejeitar",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("aprovacoes"),
  validateBody(rejeitarMovimentacaoSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(
        await rejeitarTransferencia(req.user!, req.params.id, req.body.motivo)
      );
    } catch (e) {
      next(e);
    }
  }
);
