import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  loginSchema,
  updateMeSchema,
  trocarSenhaSchema,
  resolvePermissoes,
  isAniversarioHoje,
  Perfil,
} from "@teep/shared";
import { prisma } from "../lib/prisma";
import {
  authenticate,
  AuthedRequest,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  AuthUser,
} from "../middleware/auth";
import { validateBody, AppError } from "../middleware/error";
import {
  deleteUploadBestEffort,
  isValidUploadPath,
  purgeOrphanAvatarFiles,
} from "../lib/uploads";
import rateLimit from "express-rate-limit";
import { temEstoqueAtivo } from "../lib/estoqueGate";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Aguarde 1 minuto." },
});

function formatDataNascimento(
  value: Date | string | null | undefined
): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function filialIdsFromUsuario(usuario: {
  filialId: string | null;
  filiaisVinculos?: Array<{ filialId: string }>;
}): string[] {
  const fromJoin = (usuario.filiaisVinculos || []).map((v) => v.filialId);
  if (fromJoin.length > 0) return [...new Set(fromJoin)];
  return usuario.filialId ? [usuario.filialId] : [];
}

function toAuthUser(usuario: {
  id: string;
  email: string;
  nome: string;
  perfil: string;
  filialId: string | null;
  deveTrocarSenha: boolean;
  filiaisVinculos?: Array<{ filialId: string }>;
}): AuthUser {
  const filialIds = filialIdsFromUsuario(usuario);
  const filialId =
    usuario.filialId && filialIds.includes(usuario.filialId)
      ? usuario.filialId
      : filialIds[0] || null;
  return {
    id: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    perfil: usuario.perfil as AuthUser["perfil"],
    filialId,
    filialIds,
    deveTrocarSenha: usuario.deveTrocarSenha,
  };
}

async function publicUser(usuario: {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  filialId: string | null;
  fotoPerfil: string | null;
  deveTrocarSenha: boolean;
  apelido?: string | null;
  telefone?: string | null;
  dataNascimento?: Date | string | null;
  perfilCompleto?: boolean;
  permissoes?: unknown;
  filiaisVinculos?: Array<{ filialId: string }>;
}) {
  const perfil = usuario.perfil as Perfil;
  const dataNascimento = formatDataNascimento(usuario.dataNascimento);
  const filialIds = filialIdsFromUsuario(usuario);
  const filialId =
    usuario.filialId && filialIds.includes(usuario.filialId)
      ? usuario.filialId
      : filialIds[0] || null;
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    filialId,
    filialIds,
    fotoPerfil: usuario.fotoPerfil,
    deveTrocarSenha: usuario.deveTrocarSenha,
    apelido: usuario.apelido ?? null,
    telefone: usuario.telefone ?? null,
    dataNascimento,
    perfilCompleto: Boolean(usuario.perfilCompleto),
    aniversarioHoje: isAniversarioHoje(dataNascimento),
    /** Premissa: operação exige ao menos um estoque cadastrado. */
    temEstoque: await temEstoqueAtivo(),
    permissoes: resolvePermissoes(
      perfil,
      (usuario.permissoes as Record<string, boolean>) || null
    ),
  };
}

authRouter.post(
  "/login",
  loginLimiter,
  validateBody(loginSchema),
  async (req, res, next) => {
    try {
      const { email, senha } = req.body as { email: string; senha: string };
      const usuario = await prisma.usuario.findUnique({
        where: { email },
        include: { filiaisVinculos: { select: { filialId: true } } },
      });
      if (!usuario || !usuario.ativo) {
        throw new AppError(401, "Credenciais inválidas");
      }
      const ok = await bcrypt.compare(senha, usuario.senhaHash);
      if (!ok) throw new AppError(401, "Credenciais inválidas");

      const authUser = toAuthUser(usuario);
      const accessToken = signAccessToken(authUser);
      const refreshToken = signRefreshToken(usuario.id);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      await prisma.refreshToken.create({
        data: { token: refreshToken, usuarioId: usuario.id, expiresAt },
      });

      res.json({
        accessToken,
        refreshToken,
        user: await publicUser(usuario),
      });
    } catch (e) {
      next(e);
    }
  }
);

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const token = String(req.body?.refreshToken || "");
    if (!token) throw new AppError(400, "refreshToken obrigatório");

    const userId = verifyRefreshToken(token);
    const stored = await prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.expiresAt < new Date() || stored.usuarioId !== userId) {
      throw new AppError(401, "Refresh inválido");
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: userId },
      include: { filiaisVinculos: { select: { filialId: true } } },
    });
    if (!usuario || !usuario.ativo) throw new AppError(401, "Usuário inativo");

    res.json({ accessToken: signAccessToken(toAuthUser(usuario)) });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/logout", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const token = String(req.body?.refreshToken || "");
    if (token) {
      await prisma.refreshToken.deleteMany({ where: { token } });
    } else if (req.user) {
      await prisma.refreshToken.deleteMany({ where: { usuarioId: req.user.id } });
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

authRouter.post(
  "/trocar-senha",
  authenticate,
  validateBody(trocarSenhaSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const { senhaAtual, senhaNova } = req.body as {
        senhaAtual?: string;
        senhaNova: string;
      };
      const usuario = await prisma.usuario.findUnique({
        where: { id: req.user!.id },
        include: { filiaisVinculos: { select: { filialId: true } } },
      });
      if (!usuario || !usuario.ativo) {
        throw new AppError(401, "Usuário inativo");
      }

      if (usuario.deveTrocarSenha) {
        // Já autenticado com a provisória — não pede de novo.
        const mesma = await bcrypt.compare(senhaNova, usuario.senhaHash);
        if (mesma) {
          throw new AppError(400, "A nova senha deve ser diferente da atual");
        }
      } else {
        if (!senhaAtual) {
          throw new AppError(400, "Senha atual obrigatória");
        }
        const ok = await bcrypt.compare(senhaAtual, usuario.senhaHash);
        if (!ok) throw new AppError(400, "Senha atual incorreta");
      }

      const senhaHash = await bcrypt.hash(senhaNova, 12);
      const updated = await prisma.usuario.update({
        where: { id: usuario.id },
        data: { senhaHash, deveTrocarSenha: false },
        include: { filiaisVinculos: { select: { filialId: true } } },
      });

      await prisma.refreshToken.deleteMany({ where: { usuarioId: usuario.id } });

      const authUser = toAuthUser(updated);
      const accessToken = signAccessToken(authUser);
      const refreshToken = signRefreshToken(updated.id);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      await prisma.refreshToken.create({
        data: { token: refreshToken, usuarioId: updated.id, expiresAt },
      });

      res.json({
        accessToken,
        refreshToken,
        user: await publicUser(updated),
      });
    } catch (e) {
      next(e);
    }
  }
);

authRouter.get("/me", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.id },
      include: {
        filial: true,
        filiaisVinculos: { select: { filialId: true } },
      },
    });
    if (!usuario) throw new AppError(404, "Usuário não encontrado");
    if (!usuario.ativo) {
      throw new AppError(401, "Usuário inativo");
    }
    res.json({
      ...(await publicUser(usuario)),
      filial: usuario.filial,
    });
  } catch (e) {
    next(e);
  }
});

authRouter.patch(
  "/me",
  authenticate,
  validateBody(updateMeSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const atual = await prisma.usuario.findUnique({
        where: { id: req.user!.id },
      });
      if (!atual) throw new AppError(404, "Usuário não encontrado");
      if (!atual.ativo) throw new AppError(401, "Usuário inativo");

      const body = req.body as {
        nome?: string;
        apelido?: string;
        telefone?: string | null;
        dataNascimento?: string | null;
        fotoPerfil?: string | null;
        perfilCompleto?: boolean;
      };

      if (
        body.fotoPerfil !== undefined &&
        body.fotoPerfil !== null &&
        !isValidUploadPath(body.fotoPerfil, "perfil", atual.id)
      ) {
        throw new AppError(400, "fotoPerfil inválida para este usuário");
      }

      const nextApelido =
        body.apelido !== undefined ? body.apelido : atual.apelido;
      const nextNascimento =
        body.dataNascimento !== undefined
          ? body.dataNascimento
          : formatDataNascimento(atual.dataNascimento);
      const markingComplete = body.perfilCompleto === true;

      if (markingComplete) {
        if (!nextApelido || nextApelido.trim().length < 2) {
          throw new AppError(400, "Informe o nome de exibição (apelido)");
        }
        if (!nextNascimento) {
          throw new AppError(400, "Informe a data de nascimento");
        }
      }

      const updated = await prisma.usuario.update({
        where: { id: atual.id },
        data: {
          ...(body.nome !== undefined ? { nome: body.nome.trim() } : {}),
          ...(body.apelido !== undefined
            ? { apelido: body.apelido.trim() }
            : {}),
          ...(body.telefone !== undefined
            ? {
                telefone:
                  body.telefone === null || body.telefone === ""
                    ? null
                    : body.telefone.trim(),
              }
            : {}),
          ...(body.dataNascimento !== undefined
            ? {
                dataNascimento: body.dataNascimento
                  ? new Date(body.dataNascimento + "T12:00:00.000Z")
                  : null,
              }
            : {}),
          ...(body.fotoPerfil !== undefined
            ? { fotoPerfil: body.fotoPerfil }
            : {}),
          ...(markingComplete ? { perfilCompleto: true } : {}),
        },
        include: { filiaisVinculos: { select: { filialId: true } } },
      });

      if (
        body.fotoPerfil !== undefined &&
        atual.fotoPerfil &&
        atual.fotoPerfil !== body.fotoPerfil
      ) {
        deleteUploadBestEffort(atual.fotoPerfil);
      }
      if (body.fotoPerfil !== undefined) {
        purgeOrphanAvatarFiles(atual.id, [body.fotoPerfil]);
      }

      res.json(await publicUser(updated));
    } catch (e) {
      next(e);
    }
  }
);
