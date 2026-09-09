import { AuthUser } from "../../middleware/auth";
import { AppError } from "../../middleware/error";
import { prisma } from "../../lib/prisma";
import { operadorFilialIds } from "../../lib/filialScope";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve filial de trabalho para tools do assistente.
 * OPERADOR: nunca retorna null se houver vínculo (usa principal ou a 1ª).
 * Admin/Gerente: requested || hint || null (consolidado).
 */
export function resolveFilialId(
  user: AuthUser,
  requested?: string | null,
  hint?: string | null
): string | null {
  if (user.perfil === "OPERADOR") {
    const ids = operadorFilialIds(user);
    if (ids.length === 0) {
      throw new AppError(403, "Operador sem filial");
    }
    const pick = requested || hint;
    if (pick) {
      if (!UUID_RE.test(pick)) throw new AppError(400, "filialId inválido");
      if (!ids.includes(pick)) {
        throw new AppError(403, "Operador sem acesso a esta filial");
      }
      return pick;
    }
    if (user.filialId && ids.includes(user.filialId)) return user.filialId;
    return ids[0]!;
  }
  const id = requested || hint || null;
  if (id && !UUID_RE.test(id)) {
    throw new AppError(400, "filialId inválido");
  }
  return id;
}

/** Escopo de filiais para consultas consolidadas do OPERADOR (lista). */
export function operadorEscopoFilialIds(user: AuthUser): string[] | null {
  if (user.perfil !== "OPERADOR") return null;
  const ids = operadorFilialIds(user);
  if (ids.length === 0) throw new AppError(403, "Operador sem filial");
  return ids;
}

export async function assertFilialAtiva(filialId: string): Promise<void> {
  const f = await prisma.filial.findFirst({
    where: { id: filialId, ativo: true },
    select: { id: true },
  });
  if (!f) throw new AppError(404, "Filial não encontrada");
}

const produtoSelectBase = {
  id: true,
  codigo: true,
  descricao: true,
  unidade: true,
  precoUnitario: true,
  controlaSerie: true,
  categoria: { select: { nome: true } },
} as const;

export async function findProdutoByCodigoOuNome(codigoOuNome: string) {
  const q = codigoOuNome.trim();
  const select = produtoSelectBase;

  const exact = await prisma.produto.findFirst({
    where: { ativo: true, codigo: { equals: q, mode: "insensitive" } },
    select,
  });
  if (exact) return exact;

  const contains = await prisma.produto.findFirst({
    where: {
      ativo: true,
      OR: [
        { codigo: { contains: q, mode: "insensitive" } },
        { descricao: { contains: q, mode: "insensitive" } },
      ],
    },
    select,
    orderBy: { codigo: "asc" },
  });
  if (contains) return contains;

  const tokens = q
    .split(/[\s,/._-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length < 2) return null;

  return prisma.produto.findFirst({
    where: {
      ativo: true,
      AND: tokens.map((t) => ({
        OR: [
          { codigo: { contains: t, mode: "insensitive" } },
          { descricao: { contains: t, mode: "insensitive" } },
        ],
      })),
    },
    select,
    orderBy: { codigo: "asc" },
  });
}
