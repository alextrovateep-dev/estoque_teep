import { Router } from "express";
import { separarPedidoSchema } from "@teep/shared";
import {
  authenticate,
  requireFilialOperador,
  AuthedRequest,
} from "../middleware/auth";
import { requirePermissao } from "../middleware/permissoes";
import { requireEstoqueParaOperar } from "../lib/estoqueGate";
import { validateBody } from "../middleware/error";
import { syncPedidosEgestor } from "../services/pedidoVendaSyncService";
import {
  listarEstoquesAcabados,
  listarPedidos,
  listarUsuariosDestinatariosPedido,
  obterPedido,
  separarPedido,
} from "../services/pedidoVendaService";

export const pedidosRouter = Router();
pedidosRouter.use(authenticate, requireFilialOperador, requireEstoqueParaOperar);

pedidosRouter.get(
  "/",
  requirePermissao("pedidos"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await listarPedidos(String(req.query.status || "ABERTO")));
    } catch (e) {
      next(e);
    }
  }
);

pedidosRouter.get(
  "/estoques-acabados",
  requirePermissao("pedidos"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await listarEstoquesAcabados(req.user!));
    } catch (e) {
      next(e);
    }
  }
);

pedidosRouter.get(
  "/usuarios-destinatarios",
  requirePermissao("pedidos"),
  async (_req, res, next) => {
    try {
      res.json(await listarUsuariosDestinatariosPedido());
    } catch (e) {
      next(e);
    }
  }
);

pedidosRouter.post(
  "/sync",
  requirePermissao("pedidos"),
  async (_req, res, next) => {
    try {
      res.json(await syncPedidosEgestor());
    } catch (e) {
      next(e);
    }
  }
);

pedidosRouter.get(
  "/:id",
  requirePermissao("pedidos"),
  async (req, res, next) => {
    try {
      res.json(await obterPedido(req.params.id));
    } catch (e) {
      next(e);
    }
  }
);

pedidosRouter.post(
  "/:id/separar",
  requirePermissao("pedidos"),
  validateBody(separarPedidoSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await separarPedido(req.user!, req.params.id, req.body));
    } catch (e) {
      next(e);
    }
  }
);
