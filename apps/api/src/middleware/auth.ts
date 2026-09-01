import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { Perfil } from "@teep/shared";
import { prisma } from "../lib/prisma";

export type AuthUser = {
  id: string;
  email: string;
  nome: string;
  perfil: Perfil;
  /** Filial principal (padrão) */
  filialId: string | null;
  /** Todas as filiais vinculadas */
  filialIds: string[];
  deveTrocarSenha?: boolean;
};

export type AuthedRequest = Request & {
  user?: AuthUser;
  permissoesResolved?: import("@teep/shared").PermissoesUsuario;
};

const accessSecret = () => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET não configurado. Configure em apps/api/.env");
  }
  return secret;
};

const refreshSecret = () => {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new Error("JWT_REFRESH_SECRET não configurado. Configure em apps/api/.env");
  }
  return secret;
};

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      nome: user.nome,
      perfil: user.perfil,
      filialId: user.filialId,
      filialIds: user.filialIds || [],
      deveTrocarSenha: Boolean(user.deveTrocarSenha),
    },
    accessSecret(),
    {
      expiresIn: (process.env.JWT_ACCESS_EXPIRES ||
        "15m") as jwt.SignOptions["expiresIn"],
    }
  );
}

export function signRefreshToken(userId: string): string {
  return jwt.sign(
    { sub: userId, type: "refresh", jti: randomUUID() },
    refreshSecret(),
    {
      expiresIn: (process.env.JWT_REFRESH_EXPIRES ||
        "7d") as jwt.SignOptions["expiresIn"],
    }
  );
}

export function verifyAccessToken(token: string): AuthUser {
  const payload = jwt.verify(token, accessSecret()) as jwt.JwtPayload;
  const filialId = (payload.filialId as string) || null;
  const rawIds = Array.isArray(payload.filialIds)
    ? (payload.filialIds as string[]).filter(Boolean)
    : [];
  const filialIds =
    rawIds.length > 0 ? rawIds : filialId ? [filialId] : [];
  return {
    id: String(payload.sub),
    email: String(payload.email),
    nome: String(payload.nome),
    perfil: payload.perfil as Perfil,
    filialId,
    filialIds,
    deveTrocarSenha: Boolean(payload.deveTrocarSenha),
  };
}

export function verifyRefreshToken(token: string): string {
  const payload = jwt.verify(token, refreshSecret()) as jwt.JwtPayload;
  if (payload.type !== "refresh") throw new Error("Token inválido");
  return String(payload.sub);
}

/** Com senha provisória, só estes paths do authRouter. */
function isPasswordChangeAllowed(req: Request): boolean {
  const method = req.method.toUpperCase();
  const path = req.path;
  if (method === "GET" && path === "/me") return true;
  if (method === "POST" && path === "/trocar-senha") return true;
  if (method === "POST" && path === "/logout") return true;
  return false;
}

export function authenticate(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  try {
    req.user = verifyAccessToken(header.slice(7));
    if (req.user.deveTrocarSenha) {
      const onAuth = req.baseUrl === "/auth";
      if (!onAuth || !isPasswordChangeAllowed(req)) {
        return res.status(403).json({
          error: "Troca de senha obrigatória",
          code: "MUST_CHANGE_PASSWORD",
        });
      }
    }
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

export function requirePerfil(...perfis: Perfil[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(403).json({ error: "Acesso negado para este perfil" });
    }
    try {
      const row = await prisma.usuario.findUnique({
        where: { id: req.user.id },
        select: { perfil: true, ativo: true },
      });
      if (!row?.ativo) {
        return res.status(401).json({ error: "Usuário inativo" });
      }
      const perfilDb = row.perfil as Perfil;
      if (!perfis.includes(perfilDb)) {
        return res.status(403).json({ error: "Acesso negado para este perfil" });
      }
      // JWT pode estar defasado após conceder/revogar admin — rotas usam perfil do DB.
      req.user.perfil = perfilDb;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export async function requireFilialOperador(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user) return next();
  try {
    const row = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      select: {
        perfil: true,
        filialId: true,
        filiaisVinculos: { select: { filialId: true } },
      },
    });
    if (!row) return next();
    req.user.perfil = row.perfil as Perfil;
    if (row.perfil !== "OPERADOR") return next();
    const ids = row.filiaisVinculos.map((v) => v.filialId);
    const hasFilial = ids.length > 0 || Boolean(row.filialId);
    if (!hasFilial) {
      return res.status(403).json({ error: "Operador sem filial vinculada" });
    }
    next();
  } catch (e) {
    next(e);
  }
}
