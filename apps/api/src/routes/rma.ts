import { Router } from "express";
import {
  anexarRmaSchema,
  adicionarRmaItemSchema,
  aprovarManutencaoRmaItemSchema,
  atualizarRmaClienteSchema,
  atualizarRmaComercialSchema,
  atualizarRmaDestinatariosSchema,
  cancelarRmaSchema,
  createRmaProcessoSchema,
  devolverRmaSchema,
  removerRmaItemSchema,
  semManutencaoRmaSchema,
  trocarRmaItemSchema,
  updateRmaFinanceiroSchema,
  updateRmaItemFinanceiroSchema,
} from "@teep/shared";
import {
  authenticate,
  requireFilialOperador,
  AuthedRequest,
} from "../middleware/auth";
import { requirePermissao, loadPermissoes } from "../middleware/permissoes";
import { validateBody } from "../middleware/error";
import {
  adicionarRmaItens,
  anexarRma,
  atualizarRmaCliente,
  atualizarRmaComercial,
  atualizarRmaDestinatarios,
  atualizarRmaFinanceiro,
  atualizarRmaItemFinanceiro,
  cancelarRma,
  criarRmaProcesso,
  devolverRmaItens,
  listarDestinatariosPadraoRma,
  listarRma,
  listarUsuariosParaDestinatarioRma,
  marcarManutencaoRealizadaRmaItem,
  marcarSemManutencaoRma,
  notificarLaudosRma,
  obterRma,
  registrarAprovacaoManutencaoRmaItem,
  removerRmaItem,
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

/** Usuários com tick RMA_ABERTO (lista padrão de destinatários). */
rmaRouter.get(
  "/destinatarios-padrao",
  requirePermissao("rma"),
  async (_req, res, next) => {
    try {
      res.json(await listarDestinatariosPadraoRma());
    } catch (e) {
      next(e);
    }
  }
);

/** Todos usuários ativos (para incluir extras na lista do RMA). */
rmaRouter.get(
  "/usuarios-destinatarios",
  requirePermissao("rma"),
  async (_req, res, next) => {
    try {
      res.json(await listarUsuariosParaDestinatarioRma());
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

rmaRouter.patch(
  "/:id/cliente",
  requirePermissao("rma"),
  validateBody(atualizarRmaClienteSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await atualizarRmaCliente(req.user!, req.params.id, req.body));
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.patch(
  "/:id/destinatarios",
  requirePermissao("rma"),
  validateBody(atualizarRmaDestinatariosSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(
        await atualizarRmaDestinatarios(req.user!, req.params.id, req.body)
      );
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.patch(
  "/:id/comercial",
  requirePermissao("rma"),
  validateBody(atualizarRmaComercialSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await atualizarRmaComercial(req.user!, req.params.id, req.body));
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.post(
  "/:id/itens/:itemId/aprovacao",
  requirePermissao("rma"),
  validateBody(aprovarManutencaoRmaItemSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(
        await registrarAprovacaoManutencaoRmaItem(
          req.user!,
          req.params.id,
          req.params.itemId,
          req.body
        )
      );
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.post(
  "/:id/itens/:itemId/manutencao-realizada",
  requirePermissao("rma"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(
        await marcarManutencaoRealizadaRmaItem(
          req.user!,
          req.params.id,
          req.params.itemId
        )
      );
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.patch(
  "/:id/itens/:itemId/financeiro",
  requirePermissao("rma_cobranca"),
  validateBody(updateRmaItemFinanceiroSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(
        await atualizarRmaItemFinanceiro(
          req.user!,
          req.params.id,
          req.params.itemId,
          req.body
        )
      );
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.post(
  "/:id/notificar-laudos",
  requirePermissao("rma"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await notificarLaudosRma(req.user!, req.params.id));
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.post(
  "/:id/itens",
  requirePermissao("rma"),
  validateBody(adicionarRmaItemSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.status(201).json(await adicionarRmaItens(req.user!, req.params.id, req.body));
    } catch (e) {
      next(e);
    }
  }
);

rmaRouter.post(
  "/:id/itens/:itemId/remover",
  requirePermissao("rma"),
  validateBody(removerRmaItemSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(
        await removerRmaItem(
          req.user!,
          req.params.id,
          req.params.itemId,
          req.body
        )
      );
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
  validateBody(cancelarRmaSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await cancelarRma(req.user!, req.params.id, req.body));
    } catch (e) {
      next(e);
    }
  }
);
