import { Router } from "express";
import {
  authenticate,
  requirePerfil,
  AuthedRequest,
} from "../middleware/auth";
import { AppError } from "../middleware/error";
import {
  listarNotificacoes,
  marcarLida,
  marcarTodasLidas,
} from "../services/NotificationService";
import {
  EMAIL_TYPES,
  type EmailType,
  getEmailSample,
} from "../services/email";
import {
  listEmailTemplatesForAdmin,
  resolveEmailTemplate,
  saveEmailTemplate,
  resetEmailTemplate,
  renderEmailFromTemplate,
  sampleVarsFor,
} from "../services/email/emailTemplateStore";
import { sendPreparedMailNow } from "../services/EmailService";
import { z } from "zod";
import { validateBody } from "../middleware/error";

export const notificacoesRouter = Router();
notificacoesRouter.use(authenticate);

notificacoesRouter.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const onlyUnread = req.query.naoLidas === "1";
    const take = req.query.take ? Number(req.query.take) : 30;
    res.json(
      await listarNotificacoes(req.user!.id, {
        take: Number.isFinite(take) ? take : 30,
        onlyUnread,
      })
    );
  } catch (e) {
    next(e);
  }
});

notificacoesRouter.patch("/:id/lida", async (req: AuthedRequest, res, next) => {
  try {
    const n = await marcarLida(req.user!.id, req.params.id);
    if (!n) throw new AppError(404, "Notificação não encontrada");
    res.json(n);
  } catch (e) {
    next(e);
  }
});

notificacoesRouter.post(
  "/marcar-todas-lidas",
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await marcarTodasLidas(req.user!.id));
    } catch (e) {
      next(e);
    }
  }
);

/** Admin: catálogo + preview/teste/edição de e-mail (D39) */
export const emailAdminRouter = Router();
emailAdminRouter.use(authenticate, requirePerfil("ADMIN"));

const updateTemplateSchema = z.object({
  subject: z.string().min(1).max(200),
  bodyText: z.string().min(1).max(20_000),
  preheader: z.string().max(200).nullable().optional(),
});

emailAdminRouter.get("/templates", async (_req, res, next) => {
  try {
    res.json(await listEmailTemplatesForAdmin());
  } catch (e) {
    next(e);
  }
});

emailAdminRouter.get("/templates/:type", async (req, res, next) => {
  try {
    const type = req.params.type as EmailType;
    if (!EMAIL_TYPES.includes(type)) {
      throw new AppError(404, "Tipo de e-mail inválido");
    }
    const def = await resolveEmailTemplate(type);
    const sample = await getEmailSample(type);
    const adminList = await listEmailTemplatesForAdmin();
    const customizado = Boolean(
      adminList.find((t) => t.type === type)?.customizado
    );
    res.json({
      type: def.type,
      label: def.label,
      subject: def.subject,
      bodyText: def.bodyText,
      preheader: def.preheader ?? null,
      placeholders: def.placeholders,
      customizado,
      preview: {
        subject: sample.subject,
        html: sample.html,
        text: sample.text,
      },
    });
  } catch (e) {
    next(e);
  }
});

emailAdminRouter.put(
  "/templates/:type",
  validateBody(updateTemplateSchema),
  async (req, res, next) => {
    try {
      const type = req.params.type as EmailType;
      if (!EMAIL_TYPES.includes(type)) {
        throw new AppError(404, "Tipo de e-mail inválido");
      }
      const saved = await saveEmailTemplate(type, req.body);
      const sample = await getEmailSample(type);
      res.json({
        type: saved.type,
        label: saved.label,
        subject: saved.subject,
        bodyText: saved.bodyText,
        preheader: saved.preheader ?? null,
        placeholders: saved.placeholders,
        customizado: true,
        preview: {
          subject: sample.subject,
          html: sample.html,
          text: sample.text,
        },
      });
    } catch (e) {
      if (e instanceof Error && e.message.includes("obrigatório")) {
        return next(new AppError(400, e.message));
      }
      next(e);
    }
  }
);

emailAdminRouter.post("/templates/:type/reset", async (req, res, next) => {
  try {
    const type = req.params.type as EmailType;
    if (!EMAIL_TYPES.includes(type)) {
      throw new AppError(404, "Tipo de e-mail inválido");
    }
    const def = await resetEmailTemplate(type);
    const sample = await getEmailSample(type);
    res.json({
      type: def.type,
      label: def.label,
      subject: def.subject,
      bodyText: def.bodyText,
      preheader: def.preheader ?? null,
      placeholders: def.placeholders,
      customizado: false,
      preview: {
        subject: sample.subject,
        html: sample.html,
        text: sample.text,
      },
    });
  } catch (e) {
    next(e);
  }
});

emailAdminRouter.post(
  "/templates/:type/preview",
  validateBody(updateTemplateSchema.partial().extend({
    subject: z.string().min(1).max(200).optional(),
    bodyText: z.string().min(1).max(20_000).optional(),
  })),
  async (req, res, next) => {
    try {
      const type = req.params.type as EmailType;
      if (!EMAIL_TYPES.includes(type)) {
        throw new AppError(404, "Tipo de e-mail inválido");
      }
      const current = await resolveEmailTemplate(type);
      const sample = renderEmailFromTemplate(
        {
          type,
          subject: req.body.subject ?? current.subject,
          bodyText: req.body.bodyText ?? current.bodyText,
          preheader:
            req.body.preheader !== undefined
              ? req.body.preheader
              : current.preheader,
        },
        sampleVarsFor(type)
      );
      res.json(sample);
    } catch (e) {
      next(e);
    }
  }
);

emailAdminRouter.post("/templates/:type/teste", async (req: AuthedRequest, res, next) => {
  try {
    const type = req.params.type as EmailType;
    if (!EMAIL_TYPES.includes(type)) {
      throw new AppError(404, "Tipo de e-mail inválido");
    }
    const to =
      (typeof req.body?.to === "string" && req.body.to.trim()) ||
      req.user!.email;
    const sample = await getEmailSample(type);
    try {
      await sendPreparedMailNow(to, sample, { asTest: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new AppError(502, msg);
    }
    res.json({ ok: true, to, type, subject: `[TESTE] ${sample.subject}` });
  } catch (e) {
    next(e);
  }
});
