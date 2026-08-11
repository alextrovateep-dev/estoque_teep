import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import multer from "multer";

function zodIssueMessage(raw: string | undefined): string {
  if (!raw) return "Dados inválidos";
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (!t || lower === "required" || lower === "invalid" || lower === "expected string, received undefined") {
    return "Dados inválidos";
  }
  return t;
}

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message;
      return res.status(400).json({
        error: zodIssueMessage(first),
        details: parsed.error.flatten(),
      });
    }
    req.body = parsed.data;
    next();
  };
}

export class AppError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Arquivo excede 10 MB" });
    }
    return res.status(400).json({ error: `Upload inválido: ${err.message}` });
  }
  console.error(err);
  return res.status(500).json({ error: "Erro interno" });
}
