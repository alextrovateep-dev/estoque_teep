import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  createUsuarioSchema,
  updateUsuarioSchema,
  filialSchema,
  categoriaSchema,
  createProdutoSchema,
  updateProdutoSchema,
  clienteSchema,
  tipoMovimentacaoSchema,
  tipoMovimentacaoObjectSchema,
  normalizeDocumento,
  onlyDigits,
  sameDocumento,
} from "@teep/shared";
import { prisma } from "../lib/prisma";
import {
  authenticate,
  requirePerfil,
  requireFilialOperador,
  AuthedRequest,
} from "../middleware/auth";
import { requirePermissao } from "../middleware/permissoes";
import { validateBody, AppError } from "../middleware/error";
import { notificarPrecoAjustado } from "../services/alertaService";
import {
  deleteUploadBestEffort,
  isValidUploadPath,
  purgeOrphanAvatarFiles,
  purgeOrphanProdutoFiles,
} from "../lib/uploads";
import { generateProvisionalPassword } from "../lib/provisionalPassword";
import { enqueueSenhaProvisoriaEmail } from "../services/acessoContaService";
import { resolvePermissoes, type Perfil } from "@teep/shared";
import { normalizeFilialIdsInput } from "../lib/filialScope";
import {
  relacionamentosDoCliente,
  relacionamentosDoProduto,
  resumoRelacionamentosClientes,
  resumoRelacionamentosProdutos,
} from "../services/parceiroHistoricoService";
import { lookupCnpj } from "../services/cnpjLookup";
import { lookupCep } from "../services/cepLookup";
import { assertPodeAtivarControlaSerie } from "../services/serieService";

export const cadastrosRouter = Router();
cadastrosRouter.use(authenticate, requireFilialOperador);

const usuarioSelect = {
  id: true,
  nome: true,
  email: true,
  perfil: true,
  filialId: true,
  ativo: true,
  receberAlertasEmail: true,
  alertasEmail: true,
  permissoes: true,
  fotoPerfil: true,
  deveTrocarSenha: true,
  criadoEm: true,
  filial: { select: { id: true, nome: true, sigla: true } },
  filiaisVinculos: {
    select: {
      filialId: true,
      filial: { select: { id: true, nome: true, sigla: true } },
    },
  },
} as const;

function mapUsuarioResponse(u: {
  perfil: string;
  permissoes: unknown;
  filialId: string | null;
  filiaisVinculos?: Array<{
    filialId: string;
    filial: { id: string; nome: string; sigla: string };
  }>;
  [key: string]: unknown;
}) {
  const filiais = (u.filiaisVinculos || []).map((v) => v.filial);
  const filialIds = filiais.map((f) => f.id);
  const { filiaisVinculos: _v, ...rest } = u;
  return {
    ...rest,
    filialIds,
    filiais,
    permissoes: resolvePermissoes(
      u.perfil as Perfil,
      (u.permissoes as Record<string, boolean>) || null
    ),
  };
}

async function assertFiliaisAtivas(ids: string[]) {
  if (ids.length === 0) return;
  const found = await prisma.filial.findMany({
    where: { id: { in: ids }, ativo: true },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw new AppError(400, "Uma ou mais filiais são inválidas ou inativas");
  }
}

// —— Filiais (Admin) ——
cadastrosRouter.get("/filiais", async (req: AuthedRequest, res, next) => {
  try {
    const ativas = req.query.ativas !== "0";
    const where = ativas ? { ativo: true } : {};
    const data = await prisma.filial.findMany({
      where,
      orderBy: { nome: "asc" },
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
});

cadastrosRouter.post(
  "/filiais",
  requirePerfil("ADMIN"),
  validateBody(filialSchema),
  async (req, res, next) => {
    try {
      const data = await prisma.filial.create({ data: req.body });
      res.status(201).json(data);
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "P2002") {
        return next(new AppError(409, "Nome ou sigla já existentes"));
      }
      next(e);
    }
  }
);

cadastrosRouter.patch(
  "/filiais/:id",
  requirePerfil("ADMIN"),
  validateBody(filialSchema.partial()),
  async (req, res, next) => {
    try {
      const data = await prisma.filial.update({
        where: { id: req.params.id },
        data: req.body,
      });
      res.json(data);
    } catch (e) {
      next(e);
    }
  }
);

// —— Usuários (Admin) ——
cadastrosRouter.get(
  "/usuarios",
  requirePerfil("ADMIN"),
  async (_req, res, next) => {
    try {
      const data = await prisma.usuario.findMany({
        select: usuarioSelect,
        orderBy: { nome: "asc" },
      });
      res.json(data.map(mapUsuarioResponse));
    } catch (e) {
      next(e);
    }
  }
);

cadastrosRouter.post(
  "/usuarios",
  requirePerfil("ADMIN"),
  validateBody(createUsuarioSchema),
  async (req, res, next) => {
    try {
      const { senha, perfil, filialId, filialIds, permissoes, ...rest } =
        req.body;
      if (perfil === "ADMIN") {
        throw new AppError(400, "Não é permitido criar outro Admin por esta API");
      }
      const ids = normalizeFilialIdsInput({ filialId, filialIds });
      if (perfil === "OPERADOR" && ids.length === 0) {
        throw new AppError(400, "Operador exige ao menos uma filial");
      }
      await assertFiliaisAtivas(ids);
      const principalId = ids[0] || null;

      const senhaProvisoria = senha || generateProvisionalPassword();
      const senhaHash = await bcrypt.hash(senhaProvisoria, 12);
      const permissoesSalvas = resolvePermissoes(
        perfil as Perfil,
        (permissoes as Record<string, boolean>) || null
      );
      const data = await prisma.usuario.create({
        data: {
          ...rest,
          perfil,
          filialId: principalId,
          senhaHash,
          deveTrocarSenha: true,
          perfilCompleto: false,
          permissoes: permissoesSalvas,
          filiaisVinculos: {
            create: ids.map((fid) => ({ filialId: fid })),
          },
        },
        select: usuarioSelect,
      });

      enqueueSenhaProvisoriaEmail({
        nome: data.nome,
        email: data.email,
        senhaProvisoria,
        motivo: "cadastro",
      });

      res.status(201).json({
        ...mapUsuarioResponse(data),
        /** Exibida uma vez ao admin (cópia de segurança se o e-mail falhar). */
        senhaProvisoria,
        emailEnviado: true,
      });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "P2002") {
        return next(new AppError(409, "E-mail já cadastrado"));
      }
      next(e);
    }
  }
);

cadastrosRouter.post(
  "/usuarios/:id/senha-provisoria",
  requirePerfil("ADMIN"),
  async (req, res, next) => {
    try {
      const usuario = await prisma.usuario.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          nome: true,
          email: true,
          perfil: true,
          ativo: true,
        },
      });
      if (!usuario) throw new AppError(404, "Usuário não encontrado");
      if (usuario.perfil === "ADMIN") {
        throw new AppError(
          400,
          "Não é permitido redefinir senha de Admin por esta API"
        );
      }
      if (!usuario.ativo) {
        throw new AppError(400, "Usuário inativo");
      }

      const senhaProvisoria = generateProvisionalPassword();
      const senhaHash = await bcrypt.hash(senhaProvisoria, 12);
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { senhaHash, deveTrocarSenha: true },
      });
      await prisma.refreshToken.deleteMany({ where: { usuarioId: usuario.id } });

      enqueueSenhaProvisoriaEmail({
        nome: usuario.nome,
        email: usuario.email,
        senhaProvisoria,
        motivo: "reset",
      });

      res.json({
        id: usuario.id,
        email: usuario.email,
        deveTrocarSenha: true,
        senhaProvisoria,
        emailEnviado: true,
      });
    } catch (e) {
      next(e);
    }
  }
);

cadastrosRouter.patch(
  "/usuarios/:id",
  requirePerfil("ADMIN"),
  validateBody(updateUsuarioSchema),
  async (req, res, next) => {
    try {
      const atual = await prisma.usuario.findUnique({
        where: { id: req.params.id },
        select: { id: true, fotoPerfil: true, perfil: true },
      });
      if (!atual) throw new AppError(404, "Usuário não encontrado");

      const { permissoes, filialIds, filialId, ...rest } = req.body;
      if (rest.perfil === "ADMIN" && atual.perfil !== "ADMIN") {
        throw new AppError(
          400,
          "Não é permitido promover usuário a Admin por esta API"
        );
      }
      if (atual.perfil === "ADMIN" && rest.perfil && rest.perfil !== "ADMIN") {
        throw new AppError(
          400,
          "Não é permitido alterar o perfil do Admin por esta API"
        );
      }

      const perfilEfetivo = (rest.perfil || atual.perfil) as Perfil;
      const syncFiliais =
        filialIds !== undefined || filialId !== undefined;
      let ids: string[] | null = null;
      if (syncFiliais) {
        ids = normalizeFilialIdsInput({ filialId, filialIds });
        if (perfilEfetivo === "OPERADOR" && ids.length === 0) {
          throw new AppError(400, "Operador exige ao menos uma filial");
        }
        await assertFiliaisAtivas(ids);
      }

      const data: Record<string, unknown> = { ...rest };
      if (ids) {
        data.filialId = ids[0] || null;
      }

      if (rest.fotoPerfil !== undefined && rest.fotoPerfil !== null) {
        if (!isValidUploadPath(rest.fotoPerfil, "perfil", atual.id)) {
          throw new AppError(400, "fotoPerfil inválida para este usuário");
        }
      }

      if (permissoes !== undefined) {
        if (perfilEfetivo === "ADMIN") {
          data.permissoes = {};
        } else {
          data.permissoes = resolvePermissoes(
            perfilEfetivo,
            permissoes as Record<string, boolean>
          );
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (ids) {
          await tx.usuarioFilial.deleteMany({ where: { usuarioId: atual.id } });
          if (ids.length > 0) {
            await tx.usuarioFilial.createMany({
              data: ids.map((fid) => ({
                usuarioId: atual.id,
                filialId: fid,
              })),
            });
          }
        }
        return tx.usuario.update({
          where: { id: req.params.id },
          data,
          select: usuarioSelect,
        });
      });

      // Filiais/permissões/desativação: invalida sessões (JWT antigo pode ter escopo velho)
      if (ids || permissoes !== undefined || rest.ativo === false) {
        await prisma.refreshToken.deleteMany({
          where: { usuarioId: updated.id },
        });
      }

      if (
        rest.fotoPerfil !== undefined &&
        atual.fotoPerfil &&
        atual.fotoPerfil !== rest.fotoPerfil
      ) {
        deleteUploadBestEffort(atual.fotoPerfil);
      }
      if (rest.fotoPerfil !== undefined) {
        purgeOrphanAvatarFiles(atual.id, [rest.fotoPerfil]);
      }

      res.json(mapUsuarioResponse(updated));
    } catch (e) {
      next(e);
    }
  }
);

// —— Categorias ——
cadastrosRouter.get("/categorias", async (req, res, next) => {
  try {
    const ativas = req.query.ativas !== "0";
    res.json(
      await prisma.categoria.findMany({
        where: ativas ? { ativo: true } : {},
        orderBy: { nome: "asc" },
      })
    );
  } catch (e) {
    next(e);
  }
});

cadastrosRouter.post(
  "/categorias",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("cadastros"),
  validateBody(categoriaSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await prisma.categoria.create({ data: req.body }));
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "P2002") {
        return next(new AppError(409, "Categoria já existe"));
      }
      next(e);
    }
  }
);

cadastrosRouter.patch(
  "/categorias/:id",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("cadastros"),
  validateBody(categoriaSchema.partial()),
  async (req, res, next) => {
    try {
      res.json(
        await prisma.categoria.update({
          where: { id: req.params.id },
          data: req.body,
        })
      );
    } catch (e) {
      next(e);
    }
  }
);

// —— Produtos ——
cadastrosRouter.get("/produtos", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const ativas = req.query.ativas !== "0";
    const where = {
      ...(ativas ? { ativo: true } : {}),
      ...(q
        ? {
            OR: [
              { codigo: { contains: q, mode: "insensitive" as const } },
              { descricao: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    res.json(
      await prisma.produto.findMany({
        where,
        include: { categoria: true },
        orderBy: { codigo: "asc" },
        take: 200,
      })
    );
  } catch (e) {
    next(e);
  }
});

cadastrosRouter.get("/produtos/busca", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json([]);
    res.json(
      await prisma.produto.findMany({
        where: {
          ativo: true,
          OR: [
            { codigo: { contains: q, mode: "insensitive" } },
            { descricao: { contains: q, mode: "insensitive" } },
          ],
        },
        include: { categoria: true },
        take: 20,
        orderBy: { codigo: "asc" },
      })
    );
  } catch (e) {
    next(e);
  }
});

/** Contagens de fornecedores/clientes por produto (histórico real). */
cadastrosRouter.get("/produtos/relacionamentos-resumo", async (_req, res, next) => {
  try {
    res.json(await resumoRelacionamentosProdutos());
  } catch (e) {
    next(e);
  }
});

cadastrosRouter.get("/produtos/:id", async (req, res, next) => {
  try {
    const p = await prisma.produto.findUnique({
      where: { id: req.params.id },
      include: { categoria: true },
    });
    if (!p) throw new AppError(404, "Produto não encontrado");
    res.json(p);
  } catch (e) {
    next(e);
  }
});

/** Fornecedores (ENTRADA) e clientes (SAIDA) do produto. */
cadastrosRouter.get("/produtos/:id/relacionamentos", async (req, res, next) => {
  try {
    const exists = await prisma.produto.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!exists) throw new AppError(404, "Produto não encontrado");
    res.json(await relacionamentosDoProduto(req.params.id));
  } catch (e) {
    next(e);
  }
});

cadastrosRouter.post(
  "/produtos",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("cadastros"),
  validateBody(createProdutoSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(
        await prisma.produto.create({
          data: { ...req.body, fotos: [] },
          include: { categoria: true },
        })
      );
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "P2002") {
        return next(new AppError(409, "Código já cadastrado"));
      }
      next(e);
    }
  }
);

cadastrosRouter.patch(
  "/produtos/:id",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("cadastros"),
  validateBody(updateProdutoSchema),
  async (req, res, next) => {
    try {
      const atual = await prisma.produto.findUnique({
        where: { id: req.params.id },
      });
      if (!atual) throw new AppError(404, "Produto não encontrado");

      const min =
        req.body.estoqueMinimo !== undefined
          ? Number(req.body.estoqueMinimo)
          : atual.estoqueMinimo;
      const max =
        req.body.estoqueMaximo !== undefined
          ? Number(req.body.estoqueMaximo)
          : atual.estoqueMaximo;
      if (min > 0 && max > 0 && max < min) {
        throw new AppError(400, "Estoque máximo deve ser ≥ estoque mínimo");
      }

      const precoAnterior = Number(atual.precoUnitario);
      const precoNovo =
        req.body.precoUnitario !== undefined
          ? Number(req.body.precoUnitario)
          : precoAnterior;
      const precoMudou =
        req.body.precoUnitario !== undefined && precoNovo !== precoAnterior;

      if (Array.isArray(req.body.fotos)) {
        for (const f of req.body.fotos as string[]) {
          if (!isValidUploadPath(f, "produto", atual.id)) {
            throw new AppError(400, `Foto inválida para este produto: ${f}`);
          }
        }
        // dedup preservando ordem
        req.body.fotos = [
          ...new Set(req.body.fotos as string[]),
        ];
      }

      if (req.body.controlaSerie === true && !atual.controlaSerie) {
        await prisma.$transaction(async (tx) => {
          await assertPodeAtivarControlaSerie(tx, atual.id);
        });
      }

      const fotosAnteriores = Array.isArray(atual.fotos)
        ? (atual.fotos as string[])
        : [];

      const updated = await prisma.produto.update({
        where: { id: req.params.id },
        data: req.body,
        include: { categoria: true },
      });

      if (Array.isArray(req.body.fotos)) {
        const novas = req.body.fotos as string[];
        const novasSet = new Set(novas);
        for (const old of fotosAnteriores) {
          if (!novasSet.has(old)) deleteUploadBestEffort(old);
        }
        purgeOrphanProdutoFiles(atual.id, novas);
      }

      if (precoMudou) {
        notificarPrecoAjustado({
          produtoCodigo: updated.codigo,
          produtoDescricao: updated.descricao,
          precoAnterior,
          precoNovo,
        });
      }

      res.json(updated);
    } catch (e) {
      next(e);
    }
  }
);

// —— Clientes ——
cadastrosRouter.get("/clientes", async (req, res, next) => {
  try {
    const ativas = req.query.ativas !== "0";
    res.json(
      await prisma.cliente.findMany({
        where: ativas ? { ativo: true } : {},
        orderBy: { nome: "asc" },
      })
    );
  } catch (e) {
    next(e);
  }
});

/** Contagens de produtos comprados/vendidos por cadastro (histórico real). */
cadastrosRouter.get("/clientes/relacionamentos-resumo", async (_req, res, next) => {
  try {
    res.json(await resumoRelacionamentosClientes());
  } catch (e) {
    next(e);
  }
});

/** Consulta CNPJ (proxy: publica.cnpj.ws → BrasilAPI). */
cadastrosRouter.get(
  "/clientes/cnpj/:cnpj",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("cadastros"),
  async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.json(await lookupCnpj(String(req.params.cnpj || "")));
    } catch (e) {
      next(e);
    }
  }
);

/** Consulta CEP (proxy: ViaCEP → BrasilAPI). */
cadastrosRouter.get(
  "/clientes/cep/:cep",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("cadastros"),
  async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.json(await lookupCep(String(req.params.cep || "")));
    } catch (e) {
      next(e);
    }
  }
);

/** Produtos comprados (ENTRADA) e vendidos (SAIDA) para o cadastro. */
cadastrosRouter.get("/clientes/:id/relacionamentos", async (req, res, next) => {
  try {
    const exists = await prisma.cliente.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!exists) throw new AppError(404, "Cliente/fornecedor não encontrado");
    res.json(await relacionamentosDoCliente(req.params.id));
  } catch (e) {
    next(e);
  }
});

cadastrosRouter.post(
  "/clientes",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("cadastros"),
  validateBody(clienteSchema),
  async (req, res, next) => {
    try {
      const data = { ...req.body };
      if ("documento" in data) {
        data.documento = normalizeDocumento(data.documento);
      }
      if (data.documento) {
        const dup = await findClienteByDocumento(data.documento);
        if (dup) {
          throw new AppError(409, "CNPJ/documento já cadastrado");
        }
      }
      res.status(201).json(await prisma.cliente.create({ data }));
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "P2002") {
        return next(new AppError(409, "CNPJ/documento já cadastrado"));
      }
      next(e);
    }
  }
);

cadastrosRouter.patch(
  "/clientes/:id",
  requirePerfil("ADMIN", "GERENTE"),
  requirePermissao("cadastros"),
  validateBody(clienteSchema.partial()),
  async (req, res, next) => {
    try {
      const data = { ...req.body };
      if ("documento" in data) {
        data.documento = normalizeDocumento(data.documento);
        if (data.documento) {
          const dup = await findClienteByDocumento(
            data.documento,
            req.params.id
          );
          if (dup) {
            throw new AppError(409, "CNPJ/documento já cadastrado");
          }
        }
      }
      res.json(
        await prisma.cliente.update({
          where: { id: req.params.id },
          data,
        })
      );
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "P2002") {
        return next(new AppError(409, "CNPJ/documento já cadastrado"));
      }
      next(e);
    }
  }
);

/** Localiza cadastro pelo CNPJ ignorando pontuação (legado digits-only). */
async function findClienteByDocumento(
  documento: string,
  excludeId?: string
): Promise<{ id: string } | null> {
  const digits = onlyDigits(documento);
  if (!digits) return null;
  const candidatos = await prisma.cliente.findMany({
    where: {
      documento: { not: null },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, documento: true },
  });
  const hit = candidatos.find((c) => sameDocumento(c.documento, digits));
  return hit ? { id: hit.id } : null;
}

// —— Tipos ——
cadastrosRouter.get("/tipos-movimentacao", async (req: AuthedRequest, res, next) => {
  try {
    const paraLancamento = req.query.paraLancamento === "1";
    const paraFiltro = req.query.paraFiltro === "1";

    // Filtros da linha do tempo: todos os tipos ativos (inclui sistema)
    if (paraFiltro) {
      return res.json(
        await prisma.tipoMovimentacao.findMany({
          where: { ativo: true },
          orderBy: { nome: "asc" },
        })
      );
    }

    if (!paraLancamento && req.user?.perfil === "ADMIN") {
      return res.json(
        await prisma.tipoMovimentacao.findMany({ orderBy: { nome: "asc" } })
      );
    }

    const all = await prisma.tipoMovimentacao.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
    });

    if (!paraLancamento) {
      return res.json(all.filter((t) => !t.sistema));
    }

    // Lançamento: filtra por flags de perfil (cadastro), não por lista fixa de nomes
    const perfil = req.user!.perfil;
    res.json(
      all.filter((t) => {
        if (t.sistema) return false;
        if (perfil === "OPERADOR") return t.permitidoOperador;
        if (perfil === "GERENTE" || perfil === "ADMIN") return t.permitidoGerente;
        return false;
      })
    );
  } catch (e) {
    next(e);
  }
});

cadastrosRouter.post(
  "/tipos-movimentacao",
  requirePerfil("ADMIN"),
  validateBody(tipoMovimentacaoSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(
        await prisma.tipoMovimentacao.create({
          data: {
            nome: req.body.nome,
            operacao: req.body.operacao,
            requerAprovacao: req.body.requerAprovacao ?? false,
            permitidoOperador: req.body.permitidoOperador ?? false,
            permitidoGerente: req.body.permitidoGerente ?? true,
            geraAlertaRetorno: req.body.geraAlertaRetorno ?? false,
            diasAlerta: req.body.diasAlerta ?? [15, 30, 45, 60],
            ehRetornoDeId: req.body.ehRetornoDeId ?? null,
            requerTermoComodato: req.body.requerTermoComodato ?? false,
            requerCliente:
              req.body.requerCliente === true ||
              req.body.geraAlertaRetorno === true ||
              Boolean(req.body.ehRetornoDeId) ||
              req.body.requerTermoComodato === true,
            descricao: req.body.descricao ?? null,
            sistema: false,
          },
        })
      );
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "P2002") {
        return next(new AppError(409, "Tipo já existe"));
      }
      next(e);
    }
  }
);

cadastrosRouter.patch(
  "/tipos-movimentacao/:id",
  requirePerfil("ADMIN"),
  validateBody(tipoMovimentacaoObjectSchema.partial()),
  async (req, res, next) => {
    try {
      const existing = await prisma.tipoMovimentacao.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) throw new AppError(404, "Tipo não encontrado");

      const usado = await prisma.movimentacao.count({
        where: { tipoId: existing.id },
      });

      const data = { ...req.body };
      // Tipos de sistema: não mudam natureza nem flag sistema
      if (existing.sistema) {
        delete data.operacao;
        delete data.sistema;
        delete data.nome;
      } else {
        delete data.sistema; // nunca promover/remover sistema pela API de cadastro
      }
      // Natureza travada após primeiro uso (histórico)
      if (usado > 0) {
        delete data.operacao;
      }

      const geraAlerta =
        data.geraAlertaRetorno ?? existing.geraAlertaRetorno;
      const ehRetorno =
        data.ehRetornoDeId !== undefined
          ? data.ehRetornoDeId
          : existing.ehRetornoDeId;
      const termo =
        data.requerTermoComodato ?? existing.requerTermoComodato;
      if (geraAlerta || ehRetorno || termo) {
        data.requerCliente = true;
      }

      res.json(
        await prisma.tipoMovimentacao.update({
          where: { id: req.params.id },
          data,
        })
      );
    } catch (e) {
      next(e);
    }
  }
);
