import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";

/** IDs de filiais permitidas (JWT ou legado filialId único). */
export function operadorFilialIds(user: AuthUser): string[] {
  if (user.filialIds && user.filialIds.length > 0) {
    return user.filialIds;
  }
  return user.filialId ? [user.filialId] : [];
}

export function assertOperadorTemFilial(user: AuthUser): void {
  if (user.perfil === "OPERADOR" && operadorFilialIds(user).length === 0) {
    throw new AppError(403, "Operador sem filial");
  }
}

/** OPERADOR só acessa filiais vinculadas; outros perfis não restringe. */
export function assertOperadorPodeFilial(
  user: AuthUser,
  filialId: string
): void {
  if (user.perfil !== "OPERADOR") return;
  const ids = operadorFilialIds(user);
  if (ids.length === 0) throw new AppError(403, "Operador sem filial");
  if (!ids.includes(filialId)) {
    throw new AppError(403, "Operador sem acesso a esta filial");
  }
}

/**
 * Resolve filial de trabalho do OPERADOR.
 * Se `requested` vier e estiver na lista, usa; senão principal ou primeira.
 */
export function resolveOperadorFilialId(
  user: AuthUser,
  requested?: string | null
): string {
  const ids = operadorFilialIds(user);
  if (ids.length === 0) throw new AppError(403, "Operador sem filial");
  if (requested) {
    if (!ids.includes(requested)) {
      throw new AppError(403, "Operador sem acesso a esta filial");
    }
    return requested;
  }
  if (user.filialId && ids.includes(user.filialId)) return user.filialId;
  return ids[0]!;
}

/** Normaliza lista vinda do cadastro (filialIds ou filialId legado). */
export function normalizeFilialIdsInput(input: {
  filialIds?: string[] | null;
  filialId?: string | null;
}): string[] {
  const fromArray = (input.filialIds || []).filter(Boolean);
  if (fromArray.length > 0) {
    return [...new Set(fromArray)];
  }
  if (input.filialId) return [input.filialId];
  return [];
}
