import { prisma } from "./prisma";
import { AppError } from "../middleware/error";
import type { RequestHandler } from "express";

/** Há ao menos um estoque (filial) ativo cadastrado. */
export async function temEstoqueAtivo(): Promise<boolean> {
  const n = await prisma.filial.count({ where: { ativo: true } });
  return n > 0;
}

export async function assertTemEstoqueAtivo(): Promise<void> {
  if (await temEstoqueAtivo()) return;
  throw new AppError(
    403,
    "Cadastre ao menos um estoque (Admin → Estoques) antes de operar"
  );
}

/**
 * Bloqueia escrita operacional sem estoque.
 * GET/HEAD/OPTIONS passam (navegação/consulta).
 * Cadastro de estoques fica em /filiais (cadastros) — fora deste gate.
 */
export const requireEstoqueParaOperar: RequestHandler = (req, res, next) => {
  const m = req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") {
    next();
    return;
  }
  void assertTemEstoqueAtivo()
    .then(() => next())
    .catch((e) => next(e));
};
