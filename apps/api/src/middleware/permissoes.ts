import {
  PermissaoKey,
  PermissoesUsuario,
  resolvePermissoes,
} from "@teep/shared";
import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthedRequest } from "./auth";

type ReqPerm = AuthedRequest & {
  perfilDb?: string;
  usuarioAtivo?: boolean;
};

/** Carrega permissoes efetivas do usuário autenticado (sempre do DB). */
export async function loadPermissoes(
  req: AuthedRequest
): Promise<PermissoesUsuario> {
  if (req.permissoesResolved) return req.permissoesResolved;
  const user = req.user!;
  const row = await prisma.usuario.findUnique({
    where: { id: user.id },
    select: { permissoes: true, perfil: true, ativo: true },
  });
  const r = req as ReqPerm;
  if (!row || !row.ativo) {
    r.usuarioAtivo = false;
    r.perfilDb = undefined;
    // Sem bypass: mapa vazio (nenhuma key true)
    req.permissoesResolved = resolvePermissoes("OPERADOR", {
      dashboard: false,
      assistente: false,
      lancamentos: false,
      transferencias: false,
      movimentacoes: false,
      aprovacoes: false,
      cadastros_produtos_ver: false,
      cadastros_produtos_editar: false,
      cadastros_clientes_ver: false,
      cadastros_clientes_editar: false,
      cadastros_arvore_ver: false,
      cadastros_arvore_editar: false,
      estoque_init: false,
      rma: false,
      rma_cobranca: false,
      relatorios: false,
    });
    return req.permissoesResolved;
  }
  r.usuarioAtivo = true;
  r.perfilDb = row.perfil;
  req.permissoesResolved = resolvePermissoes(
    row.perfil as typeof user.perfil,
    (row.permissoes as Record<string, boolean>) || null
  );
  return req.permissoesResolved;
}

export function requirePermissao(...keys: PermissaoKey[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Não autenticado" });
      }
      const perms = await loadPermissoes(req);
      const r = req as ReqPerm;
      if (r.usuarioAtivo === false) {
        return res.status(401).json({
          error: "Usuário inativo",
          code: "USER_INACTIVE",
        });
      }
      // Só ADMIN do DB — nunca fallback para JWT
      if (r.perfilDb === "ADMIN") return next();

      const ok = keys.some((k) => Boolean(perms[k]));
      if (!ok) {
        return res.status(403).json({
          error: "Sem permissão para esta ação",
          code: "FORBIDDEN_PERMISSION",
        });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
