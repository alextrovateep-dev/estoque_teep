import { Router } from "express";
import rateLimit from "express-rate-limit";
import { assistenteChatSchema } from "@teep/shared";
import {
  authenticate,
  requireFilialOperador,
  AuthedRequest,
} from "../middleware/auth";
import { requirePermissao } from "../middleware/permissoes";
import { AppError, validateBody } from "../middleware/error";
import {
  getAssistenteStatus,
  runAssistenteChat,
} from "../services/assistente/orchestrator";
import { isAssistenteEnabled } from "../services/assistente/llm";
import { takeAssistenteExport } from "../services/assistente/assistenteExportTokenStore";

export const assistenteRouter = Router();

assistenteRouter.use(
  authenticate,
  requireFilialOperador,
  requirePermissao("assistente")
);

const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const u = (req as AuthedRequest).user;
    return u?.id || req.ip || "anon";
  },
  message: { error: "Muitas perguntas ao assistente. Aguarde 1 minuto." },
});

assistenteRouter.get("/status", (_req, res) => {
  res.json(getAssistenteStatus());
});

assistenteRouter.get(
  "/export/:token",
  async (req: AuthedRequest, res, next) => {
    try {
      const token = String(req.params.token || "");
      if (!token || token.length < 16 || token.length > 128) {
        throw new AppError(404, "Download não encontrado ou expirado");
      }
      const entry = takeAssistenteExport(token, req.user!.id);
      if (!entry) {
        throw new AppError(404, "Download não encontrado ou expirado");
      }
      const contentType =
        entry.format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${entry.filename}"; filename*=UTF-8''${encodeURIComponent(entry.filename)}`
      );
      res.send(entry.buffer);
    } catch (e) {
      next(e);
    }
  }
);

assistenteRouter.post(
  "/chat",
  chatLimiter,
  validateBody(assistenteChatSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      if (!isAssistenteEnabled()) {
        throw new AppError(503, "Assistente de estoque desligado");
      }
      const { message, history, filialId } = req.body as {
        message: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
        filialId?: string | null;
      };
      const result = await runAssistenteChat({
        user: req.user!,
        message,
        history,
        filialId,
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);
