import { z } from "zod";
import {
  ALERTA_EVENTOS,
  CLIENTE_TIPOS,
  OPERACOES,
  PERFIS,
  PERMISSAO_KEYS,
  parseYmd,
} from "./constants";
import {
  isValidCnpj,
  MSG_CNPJ_INVALIDO,
  MSG_CNPJ_OBRIGATORIO,
  onlyDigits,
  tipoExigeCnpj,
} from "./documento";

const alertasEmailSchema = z
  .record(z.enum(ALERTA_EVENTOS), z.boolean())
  .default({});

const permissoesSchema = z
  .record(z.enum(PERMISSAO_KEYS), z.boolean())
  .optional();

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((v) => v.toLowerCase()),
  senha: z.string().min(1),
});

const senhaForteSchema = z
  .string()
  .min(8, "senha deve ter no mínimo 8 caracteres")
  .regex(/[A-Z]/, "senha deve ter 1 maiúscula")
  .regex(/[0-9]/, "senha deve ter 1 número");

export const createUsuarioBaseSchema = z.object({
  nome: z.string().min(2).max(100),
  email: z
    .string()
    .trim()
    .email()
    .max(100)
    .transform((v) => v.toLowerCase()),
  /** Opcional: se omitida, a API gera senha provisória e envia por e-mail */
  senha: senhaForteSchema.optional(),
  perfil: z.enum(PERFIS),
  /** Legado / filial principal — preferir filialIds */
  filialId: z.string().uuid().nullable().optional(),
  /** Uma ou mais filiais (Operador exige ≥ 1) */
  filialIds: z.array(z.string().uuid()).optional(),
  ativo: z.boolean().optional(),
  receberAlertasEmail: z.boolean().optional().default(false),
  alertasEmail: alertasEmailSchema.optional(),
  /** Overrides de tela/ação (Admin configura; Admin perfil ignora) */
  permissoes: permissoesSchema,
});

function refineOperadorFiliais(
  data: {
    perfil?: string;
    filialId?: string | null;
    filialIds?: string[];
  },
  ctx: z.RefinementCtx
) {
  if (data.perfil !== "OPERADOR") return;
  const ids =
    data.filialIds && data.filialIds.length > 0
      ? data.filialIds
      : data.filialId
        ? [data.filialId]
        : [];
  if (ids.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Operador exige ao menos uma filial",
      path: ["filialIds"],
    });
  }
}

export const createUsuarioSchema =
  createUsuarioBaseSchema.superRefine(refineOperadorFiliais);

const fotoPerfilSchema = z
  .string()
  .max(255)
  .regex(/^\/uploads\/fotos-perfil\//, "fotoPerfil inválida")
  .nullable();

export const updateUsuarioSchema = createUsuarioBaseSchema
  .partial()
  .omit({ senha: true })
  .extend({
    fotoPerfil: fotoPerfilSchema.optional(),
  })
  .superRefine(refineOperadorFiliais);

/** Qualquer autenticado atualiza o próprio perfil */
export const updateMeSchema = z.object({
  nome: z.string().min(2).max(100).optional(),
  apelido: z.string().min(2).max(80).optional(),
  telefone: z.preprocess(
    (v) => (v === "" ? null : v),
    z
      .string()
      .max(20)
      .regex(/^[\d\s()+-]*$/, "telefone inválido")
      .nullable()
      .optional()
  ),
  dataNascimento: z.preprocess(
    (v) => (v === "" ? null : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD")
      .nullable()
      .optional()
  ),
  fotoPerfil: fotoPerfilSchema.optional(),
  /** Marca wizard de 1º acesso como concluído */
  perfilCompleto: z.boolean().optional(),
});

/** Troca obrigatória (1º acesso) ou voluntária.
 * `senhaAtual` opcional no 1º acesso (já autenticado com a provisória);
 * obrigatória na troca voluntária (perfil). */
export const trocarSenhaSchema = z
  .object({
    senhaAtual: z.string().min(1).optional(),
    senhaNova: senhaForteSchema,
    senhaNovaConfirmacao: z.string().min(1),
  })
  .refine((d) => d.senhaNova === d.senhaNovaConfirmacao, {
    message: "Confirmação não confere",
    path: ["senhaNovaConfirmacao"],
  })
  .refine((d) => !d.senhaAtual || d.senhaAtual !== d.senhaNova, {
    message: "A nova senha deve ser diferente da atual",
    path: ["senhaNova"],
  });

export const filialSchema = z.object({
  nome: z.string().min(2).max(80),
  sigla: z.string().min(1).max(5),
  cidade: z.string().max(80).optional().nullable(),
  estado: z.string().length(2).optional().nullable(),
  ativo: z.boolean().optional(),
  estoqueAcabados: z.boolean().optional(),
});

export const categoriaSchema = z.object({
  nome: z.string().min(1).max(50),
  descricao: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
});

function refineMinMax(
  data: { estoqueMinimo?: number; estoqueMaximo?: number },
  ctx: z.RefinementCtx
) {
  const min = data.estoqueMinimo ?? 0;
  const max = data.estoqueMaximo ?? 0;
  if (min > 0 && max > 0 && max < min) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Estoque máximo deve ser ≥ estoque mínimo",
      path: ["estoqueMaximo"],
    });
  }
}

const fotosProdutoSchema = z
  .array(
    z
      .string()
      .max(255)
      .regex(/^\/uploads\/conteudo\/produtos\//, "path de foto inválido")
  )
  .max(20);

const seriesArraySchema = z
  .array(z.string().trim().min(1).max(80))
  .max(500)
  .optional();

export const produtoSchema = z
  .object({
    codigo: z.string().min(1).max(50),
    descricao: z.string().min(1).max(150),
    categoriaId: z.string().uuid(),
    unidade: z.string().max(10).optional(),
    precoUnitario: z.coerce.number().min(0).optional(),
    /** 0 = sem alerta de mínimo */
    estoqueMinimo: z.coerce.number().int().min(0).optional(),
    /** 0 = sem alerta de máximo */
    estoqueMaximo: z.coerce.number().int().min(0).optional(),
    fotos: fotosProdutoSchema.optional(),
    controlaSerie: z.boolean().optional(),
    ativo: z.boolean().optional(),
  })
  .superRefine(refineMinMax);

/** Opções de geração automática de série no cadastro do produto. */
export const configuracaoSerieSchema = z.object({
  formato: z.string().min(1).max(80).default("{codigo}{ano2}{seq4}"),
  geracaoAutomatica: z.boolean().default(true),
  tamanhoSequencial: z.coerce.number().int().min(3).max(6).default(4),
  prefixoFixo: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().max(20).nullable().optional()
  ),
  sufixoFixo: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().max(20).nullable().optional()
  ),
  reiniciarAnual: z.boolean().default(true),
});

export const createProdutoSchema = z
  .object({
    codigo: z.string().min(1).max(50),
    descricao: z.string().min(1).max(150),
    categoriaId: z.string().uuid(),
    unidade: z.string().max(10).default("UN"),
    precoUnitario: z.coerce.number().min(0).default(0),
    estoqueMinimo: z.coerce.number().int().min(0).default(0),
    estoqueMaximo: z.coerce.number().int().min(0).default(0),
    controlaSerie: z.boolean().optional().default(false),
    configuracaoSerie: configuracaoSerieSchema.optional(),
    /** Fotos só via PATCH após o produto existir (upload exige produtoId) */
    ativo: z.boolean().optional(),
  })
  .superRefine(refineMinMax);

/** Linha da BOM (árvore de componentes). */
export const produtoComponenteItemSchema = z.object({
  produtoFilhoId: z.string().uuid(),
  quantidade: z.coerce.number().positive().max(1_000_000),
  fantasma: z.boolean().default(false),
});

export const updateProdutoSchema = z
  .object({
    codigo: z.string().min(1).max(50).optional(),
    descricao: z.string().min(1).max(150).optional(),
    categoriaId: z.string().uuid().optional(),
    unidade: z.string().max(10).optional(),
    precoUnitario: z.coerce.number().min(0).optional(),
    estoqueMinimo: z.coerce.number().int().min(0).optional(),
    estoqueMaximo: z.coerce.number().int().min(0).optional(),
    fotos: fotosProdutoSchema.optional(),
    controlaSerie: z.boolean().optional(),
    configuracaoSerie: configuracaoSerieSchema.nullable().optional(),
    /** Se enviado, substitui a BOM na mesma transação do PATCH. */
    componentes: z.array(produtoComponenteItemSchema).max(200).optional(),
    ativo: z.boolean().optional(),
  })
  .superRefine(refineMinMax);

const emptyToNull = (v: unknown) =>
  v === "" || v === undefined ? null : v;

const clienteObjectSchema = z.object({
  nome: z.string().min(1).max(150),
  nomeFantasia: z.preprocess(
    emptyToNull,
    z.string().max(120).nullable().optional()
  ),
  documento: z.preprocess(
    emptyToNull,
    z.string().max(20).nullable().optional()
  ),
  tipo: z.enum(CLIENTE_TIPOS),
  email: z.preprocess(
    emptyToNull,
    z.string().email().max(100).nullable().optional()
  ),
  telefone: z.preprocess(
    emptyToNull,
    z.string().max(20).nullable().optional()
  ),
  cep: z.preprocess(emptyToNull, z.string().max(9).nullable().optional()),
  logradouro: z.preprocess(
    emptyToNull,
    z.string().max(120).nullable().optional()
  ),
  numero: z.preprocess(emptyToNull, z.string().max(20).nullable().optional()),
  complemento: z.preprocess(
    emptyToNull,
    z.string().max(80).nullable().optional()
  ),
  bairro: z.preprocess(emptyToNull, z.string().max(80).nullable().optional()),
  cidade: z.preprocess(emptyToNull, z.string().max(50).nullable().optional()),
  estado: z.preprocess(
    emptyToNull,
    z.string().length(2).nullable().optional()
  ),
  ativo: z.boolean().optional(),
  /** Usuário comercial padrão (opcional no cadastro) */
  responsavelComercialId: z.preprocess(
    emptyToNull,
    z.string().uuid().nullable().optional()
  ),
});

function issueCnpj(
  ctx: z.RefinementCtx,
  message: string
) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["documento"],
    message,
  });
}

export const clienteSchema = clienteObjectSchema.superRefine((data, ctx) => {
  if (tipoExigeCnpj(data.tipo)) {
    if (!isValidCnpj(data.documento)) {
      issueCnpj(ctx, MSG_CNPJ_OBRIGATORIO);
    }
    return;
  }
  if (onlyDigits(data.documento || "").length === 14 && !isValidCnpj(data.documento)) {
    issueCnpj(ctx, MSG_CNPJ_INVALIDO);
  }
});

export const updateClienteSchema = clienteObjectSchema
  .partial()
  .superRefine((data, ctx) => {
    if (data.documento === undefined) return;
    if (tipoExigeCnpj(data.tipo)) {
      if (!isValidCnpj(data.documento)) {
        issueCnpj(ctx, MSG_CNPJ_OBRIGATORIO);
      }
      return;
    }
    if (onlyDigits(data.documento || "").length === 14 && !isValidCnpj(data.documento)) {
      issueCnpj(ctx, MSG_CNPJ_INVALIDO);
    }
  });

export const tipoMovimentacaoObjectSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
      message: "Código: use letras, números, ponto, hífen ou underscore",
    }),
  nome: z.string().min(1).max(50),
  /** ENTRADA = entra em 1 estoque; SAIDA = sai de 1 estoque; TRANSFERENCIA = sai de A e entra em B */
  operacao: z.enum(OPERACOES),
  requerCliente: z.boolean().optional(),
  requerAprovacao: z.boolean().optional(),
  permitidoOperador: z.boolean().optional(),
  permitidoGerente: z.boolean().optional(),
  geraAlertaRetorno: z.boolean().optional(),
  diasAlerta: z
    .array(z.coerce.number().int().min(1).max(365))
    .min(1)
    .max(12)
    .optional()
    .nullable(),
  ehRetornoDeId: z.string().uuid().optional().nullable(),
  requerTermoComodato: z.boolean().optional(),
  /** SAIDA/TRANSFERENCIA: na saída, baixa componentes não-fantasma da árvore */
  baixaPorArvore: z.boolean().optional(),
  /** ENTRADA: usada pelo RMA ao abrir/incluir item (entrada automática no estoque RMA) */
  rmaEntradaEstoque: z.boolean().optional(),
  /** SAIDA: usada pelo RMA em devolver/trocar */
  rmaSaidaCliente: z.boolean().optional(),
  /** SAIDA: usada na separação de pedidos eGestor */
  saidaPedidoVenda: z.boolean().optional(),
  /** Estoque afetado (ENTRADA/SAIDA) ou origem (TRANSFERENCIA). Obrigatório se não for sistema/RMA-pedido. */
  filialId: z.string().uuid().optional().nullable(),
  /** Destino — obrigatório em TRANSFERENCIA */
  filialDestinoId: z.string().uuid().optional().nullable(),
  descricao: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
  /** Só API interna / seed — cadastro admin não envia */
  sistema: z.boolean().optional(),
});

type TipoMovimentacaoShape = z.infer<typeof tipoMovimentacaoObjectSchema>;

/** Regras de negócio do tipo — usadas no create e no merge do PATCH. */
export function refineTipoMovimentacao(
  data: TipoMovimentacaoShape,
  ctx: z.RefinementCtx,
  opts?: { requireEstoqueFixo?: boolean }
) {
  const requireEstoqueFixo = opts?.requireEstoqueFixo !== false;
  const alerta = data.geraAlertaRetorno === true;
  const retorno = Boolean(data.ehRetornoDeId);
  const termo = data.requerTermoComodato === true;
  const arvore = data.baixaPorArvore === true;
  const rmaEnt = data.rmaEntradaEstoque === true;
  const rmaSai = data.rmaSaidaCliente === true;
  const saidaPedido = data.saidaPedidoVenda === true;
  const sistema = data.sistema === true;
  if (
    (alerta || retorno || termo || rmaEnt || rmaSai) &&
    data.requerCliente === false
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Tipos com alerta de retorno, vínculo de retorno, termo de comodato ou flag RMA devem exigir cliente",
      path: ["requerCliente"],
    });
  }
  if (alerta && data.operacao && data.operacao !== "SAIDA") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Alertas de retorno só se aplicam a tipos SAIDA",
      path: ["geraAlertaRetorno"],
    });
  }
  if (retorno && data.operacao && data.operacao !== "ENTRADA") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Vínculo ehRetornoDe só se aplica a tipos ENTRADA",
      path: ["ehRetornoDeId"],
    });
  }
  if (rmaEnt && data.operacao && data.operacao !== "ENTRADA") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Flag RMA de entrada só se aplica a tipos ENTRADA",
      path: ["rmaEntradaEstoque"],
    });
  }
  if (rmaSai && data.operacao && data.operacao !== "SAIDA") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Flag RMA de saída só se aplica a tipos SAIDA",
      path: ["rmaSaidaCliente"],
    });
  }
  if (saidaPedido && data.operacao && data.operacao !== "SAIDA") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Flag de saída de pedido só se aplica a tipos SAIDA",
      path: ["saidaPedidoVenda"],
    });
  }
  if (rmaEnt && rmaSai) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Um tipo não pode ser entrada e saída RMA ao mesmo tempo",
      path: ["rmaEntradaEstoque"],
    });
  }
  if (
    arvore &&
    data.operacao &&
    data.operacao !== "SAIDA" &&
    data.operacao !== "TRANSFERENCIA"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Baixa pela árvore só se aplica a tipos de Saída ou Transferência",
      path: ["baixaPorArvore"],
    });
  }
  if (arvore && data.requerAprovacao === true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Tipo com baixa pela árvore não pode exigir aprovação (a baixa conclui na hora)",
      path: ["requerAprovacao"],
    });
  }

  // Estoque fixo: obrigatório no create; no PATCH merge pode ficar incompleto (cutover)
  const exigeEstoqueFixo =
    !sistema && !rmaEnt && !rmaSai && !saidaPedido && Boolean(data.operacao);
  if (!exigeEstoqueFixo) return;

  if (requireEstoqueFixo) {
    if (!data.filialId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          data.operacao === "ENTRADA"
            ? "Informe o estoque de entrada"
            : data.operacao === "SAIDA"
              ? "Informe o estoque de saída"
              : "Informe o estoque de origem",
        path: ["filialId"],
      });
    }
    if (data.operacao === "TRANSFERENCIA") {
      if (!data.filialDestinoId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe o estoque de destino",
          path: ["filialDestinoId"],
        });
      } else if (
        data.filialId &&
        data.filialDestinoId &&
        data.filialId === data.filialDestinoId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Origem e destino devem ser estoques diferentes",
          path: ["filialDestinoId"],
        });
      }
    } else if (data.filialDestinoId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Destino só se aplica a transferência",
        path: ["filialDestinoId"],
      });
    }
    return;
  }

  // Update incompleto: só inconsistências quando campos estão preenchidos
  if (data.operacao === "TRANSFERENCIA") {
    if (
      data.filialId &&
      data.filialDestinoId &&
      data.filialId === data.filialDestinoId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Origem e destino devem ser estoques diferentes",
        path: ["filialDestinoId"],
      });
    }
  } else if (data.filialDestinoId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Destino só se aplica a transferência",
      path: ["filialDestinoId"],
    });
  }
}

export const tipoMovimentacaoSchema = tipoMovimentacaoObjectSchema.superRefine(
  (data, ctx) => refineTipoMovimentacao(data, ctx, { requireEstoqueFixo: true })
);

/**
 * Valida o estado mesclado (existing + PATCH).
 * `requireEstoqueFixo: false` permite tipo ainda sem estoque (cutover).
 */
export function validateTipoMovimentacaoMerged(
  data: unknown,
  opts?: { requireEstoqueFixo?: boolean }
) {
  return tipoMovimentacaoObjectSchema
    .superRefine((d, ctx) =>
      refineTipoMovimentacao(d, ctx, {
        requireEstoqueFixo: opts?.requireEstoqueFixo !== false,
      })
    )
    .safeParse(data);
}
export const createMovimentacaoSchema = z
  .object({
    tipoId: z.string().uuid(),
    /** Estoque afetado (ENTRADA/SAIDA) ou origem (TRANSFERENCIA) */
    filialId: z.string().uuid().optional(),
    /** Destino — obrigatório quando o tipo for TRANSFERENCIA */
    filialDestinoId: z.string().uuid().optional().nullable(),
    /**
     * Legado (montagem em ENTRADA). Com baixa por árvore em SAIDA/TRANSFERENCIA
     * os componentes saem do mesmo estoque de origem — este campo é ignorado.
     */
    filialComponentesId: z.string().uuid().optional().nullable(),
    clienteId: z.string().uuid().optional().nullable(),
    /** Item único (ENTRADA/SAIDA ou transferência com 1 produto) */
    produtoId: z.string().uuid().optional(),
    quantidade: z.coerce.number().positive().optional(),
    /** Números de série (obrigatório se produto.controlaSerie) */
    series: seriesArraySchema,
    precoUnitario: z.coerce.number().min(0).optional(),
    observacao: z.string().max(2000).optional().nullable(),
    /** Número da NF — uso em tipos com cliente/fornecedor */
    notaFiscalNumero: z
      .string()
      .max(60)
      .optional()
      .nullable()
      .transform((v) => {
        if (v == null) return null;
        const t = v.trim();
        return t ? t : null;
      }),
    /** Path /uploads/notas-fiscais/... após upload */
    notaFiscalArquivo: z.preprocess(
      (v) => (v === "" || v == null ? null : v),
      z
        .string()
        .max(255)
        .regex(/^\/uploads\/notas-fiscais\//, "notaFiscalArquivo inválida")
        .nullable()
        .optional()
    ),
    /** E-mails para alertas de retorno (obrigatório se tipo.geraAlertaRetorno) */
    alertaEmails: z
      .array(z.string().email().max(100))
      .max(10)
      .optional()
      .default([]),
    /** Saída aberta vinculada (tipos com ehRetornoDe) */
    movimentacaoOrigemId: z.string().uuid().optional().nullable(),
    /** Anexos tipados (termo comodato, etc.) */
    anexos: z
      .array(
        z.object({
          tipo: z.enum(["NOTA_FISCAL", "TERMO_COMODATO", "LAUDO", "OUTRO"]),
          arquivo: z
            .string()
            .max(255)
            .regex(/^\/uploads\//, "arquivo de anexo inválido"),
          label: z.string().max(120).optional().nullable(),
        })
      )
      .max(10)
      .optional()
      .default([]),
    guiaTransporte: z.string().max(120).optional().nullable(),
    /** Só TRANSFERENCIA: credita destino agora ou aguarda conferência */
    creditoDestino: z
      .enum(["IMEDIATO", "AGUARDAR_RECEBIMENTO"])
      .optional(),
    /** Multi-item (ENTRADA/SAÍDA/TRANSFERÊNCIA); se omitido, usa produtoId+quantidade */
    itens: z
      .array(
        z.object({
          produtoId: z.string().uuid(),
          quantidade: z.coerce.number().positive(),
          series: seriesArraySchema,
        })
      )
      .min(1)
      .max(20)
      .optional(),
  })
  .superRefine((data, ctx) => {
    const hasItens = Array.isArray(data.itens) && data.itens.length > 0;
    const hasSingle = Boolean(data.produtoId && data.quantidade);
    if (!hasItens && !hasSingle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe produtoId+quantidade ou itens[]",
        path: ["produtoId"],
      });
    }
    if (hasItens) {
      const ids = data.itens!.map((i) => i.produtoId);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Não repita o mesmo produto nos itens",
          path: ["itens"],
        });
      }
    }
    if (data.creditoDestino && !data.filialDestinoId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "filialDestinoId obrigatório com creditoDestino",
        path: ["filialDestinoId"],
      });
    }
  });

export const rejeitarMovimentacaoSchema = z.object({
  motivo: z
    .string()
    .max(500)
    .optional()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : undefined;
    }),
});

export const estornarMovimentacaoSchema = z.object({
  observacao: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const t = v.trim();
      return t ? t : null;
    }),
});

/** Anexar termo de comodato (ou doc) a uma saída já lançada. */
export const anexarMovimentacaoSchema = z.object({
  tipo: z.literal("TERMO_COMODATO"),
  arquivo: z
    .string()
    .max(255)
    .regex(/^\/uploads\//, "arquivo de anexo inválido"),
  label: z.string().max(120).optional().nullable(),
});

export const initEstoqueItemSchema = z.object({
  produtoId: z.string().uuid(),
  saldo: z.coerce.number().min(0),
  /** Obrigatório se produto.controlaSerie e saldo > 0 (length === saldo) */
  series: seriesArraySchema,
});

export const initEstoqueSchema = z.object({
  filialId: z.string().uuid(),
  itens: z.array(initEstoqueItemSchema).min(1),
  confirmarReinit: z.boolean().optional().default(false),
});

export const createTransferenciaItemSchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.coerce.number().positive(),
  series: seriesArraySchema,
});

export const createTransferenciaSchema = z.object({
  origemFilialId: z.string().uuid().optional(),
  destinoFilialId: z.string().uuid(),
  guiaTransporte: z.string().max(120).optional().nullable(),
  /** Opcional na API legada; padrão AGUARDAR_RECEBIMENTO */
  creditoDestino: z
    .enum(["IMEDIATO", "AGUARDAR_RECEBIMENTO"])
    .optional()
    .default("AGUARDAR_RECEBIMENTO"),
  observacao: z.string().max(2000).optional().nullable(),
  itens: z.array(createTransferenciaItemSchema).min(1),
});

/** Anexar documento à carga (NF, laudo, outro). */
export const anexarTransferenciaSchema = z.object({
  tipo: z.enum(["NOTA_FISCAL", "LAUDO", "OUTRO"]),
  arquivo: z
    .string()
    .max(255)
    .regex(/^\/uploads\//, "arquivo de anexo inválido"),
  label: z.string().max(120).optional().nullable(),
});

export const conferirTransferenciaItemSchema = z.object({
  itemId: z.string().uuid(),
  qtdRecebida: z.coerce.number().min(0),
  /** Séries confirmadas no destino (obrigatório se produto.controlaSerie) */
  seriesRecebidas: seriesArraySchema,
  justificativa: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const t = v.trim();
      return t ? t : null;
    }),
});

export const conferirTransferenciaSchema = z.object({
  itens: z.array(conferirTransferenciaItemSchema).min(1),
});

export const assistenteChatSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      })
    )
    .max(10)
    .optional()
    .default([]),
  filialId: z.string().uuid().optional().nullable(),
});

const uploadPath = z
  .string()
  .max(255)
  .regex(/^\/uploads\//, "arquivo inválido");

export const createRmaProcessoSchema = z
  .object({
    clienteId: z.string().uuid({ message: "Selecione o cliente" }),
    /** Usuário comercial responsável pela aprovação com o cliente */
    responsavelComercialId: z.string().uuid({
      message: "Selecione o responsável comercial",
    }),
    observacao: z.string().max(2000).optional().nullable(),
    prazoManutencao: z.preprocess(
      (v) => (v == null || String(v).trim() === "" ? null : String(v).trim()),
      z
        .string()
        .nullable()
        .refine((v) => v == null || parseYmd(v) != null, {
          message: "Informe uma data válida para o prazo da manutenção",
        })
    ),
    nfEntradaNumero: z
      .string({ required_error: "Informe o número da NF de entrada" })
      .trim()
      .min(1, "Informe o número da NF de entrada")
      .max(60),
    /** Path temporário /uploads/rma/_tmp/... (promovido na abertura) */
    nfEntradaArquivo: uploadPath.optional().nullable(),
    /**
     * Usuários que recebem sino/e-mail deste RMA.
     * Vazio/omitido → só o criador. Preferir pré-carregar ticks RMA_ABERTO na UI.
     */
    destinatarioIds: z.array(z.string().uuid()).max(50).optional(),
    itens: z
      .array(
        z.object({
          produtoId: z.string().uuid({ message: "Selecione o produto na lista" }),
          /** Uma ou mais séries; cada série vira 1 item RMA (qtd 1) */
          series: z
            .array(
              z
                .string()
                .trim()
                .min(1, "Informe o número de série")
                .max(80, "Número de série muito longo")
            )
            .min(1, "Informe o número de série")
            .max(500),
          observacao: z.string().max(500).optional().nullable(),
        })
      )
      .min(1, "Informe ao menos um produto com série")
      .max(50, "Máximo de 50 produtos por nota de RMA"),
  })
  .superRefine((data, ctx) => {
    const vistas = new Set<string>();
    data.itens.forEach((it, idx) => {
      for (const raw of it.series) {
        const sn = raw.trim().toLowerCase();
        if (!sn) continue;
        const key = `${it.produtoId}::${sn}`;
        if (vistas.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Número de série duplicado na nota (item ${idx + 1})`,
            path: ["itens", idx, "series"],
          });
          return;
        }
        vistas.add(key);
      }
    });
  });

/** Substitui a lista de destinatários do RMA (processo aberto). */
export const atualizarRmaDestinatariosSchema = z.object({
  destinatarioIds: z.array(z.string().uuid()).min(1).max(50),
});

export const separarPedidoSchema = z.object({
  filialId: z.string().uuid(),
  destinatarioIds: z.array(z.string().uuid()).min(1).max(50),
  itens: z
    .array(
      z.object({
        id: z.string().uuid(),
        quantidade: z.coerce.number().positive(),
        series: seriesArraySchema,
      })
    )
    .min(1)
    .max(50),
});

/** NFs / observação do processo (cobrança de manutenção é por item). */
export const updateRmaFinanceiroSchema = z.object({
  nfEntradaNumero: z.string().max(60).optional().nullable(),
  nfSaidaNumero: z.string().max(60).optional().nullable(),
  observacao: z.string().max(2000).optional().nullable(),
  prazoManutencao: z.preprocess(
    (v) => {
      if (v === undefined) return undefined;
      if (v == null || String(v).trim() === "") return null;
      return String(v).trim();
    },
    z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || v === undefined || parseYmd(v) != null, {
        message: "Informe uma data válida para o prazo da manutenção",
      })
  ),
  /** @deprecated Cobrança migrou para o item — aceito só por compat. */
  cobrou: z.boolean().optional().nullable(),
  valorCobrado: z.coerce.number().min(0).optional().nullable(),
  nfCobrancaNumero: z.string().max(60).optional().nullable(),
});

/** Cobrança de manutenção de um item do RMA. */
export const updateRmaItemFinanceiroSchema = z
  .object({
    cobrou: z.boolean().optional().nullable(),
    valorCobrado: z.coerce.number().min(0).optional().nullable(),
    nfCobrancaNumero: z.string().max(60).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.cobrou === true) {
      if (
        data.valorCobrado == null ||
        Number.isNaN(Number(data.valorCobrado)) ||
        Number(data.valorCobrado) <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe o valor cobrado (maior que zero)",
          path: ["valorCobrado"],
        });
      }
      if (!data.nfCobrancaNumero?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe o número da NF de cobrança",
          path: ["nfCobrancaNumero"],
        });
      }
    }
  });

/** Corrigir cliente do processo (RMA aberto, sem devolução/troca concluída). */
export const atualizarRmaClienteSchema = z.object({
  clienteId: z.string().uuid(),
});

/** Alterar responsável comercial (só ABERTO + aprovação PENDENTE). */
export const atualizarRmaComercialSchema = z.object({
  responsavelComercialId: z.string().uuid(),
});

/** Decisão comercial de manutenção por item. */
export const aprovarManutencaoRmaItemSchema = z.object({
  decisao: z.enum(["APROVADA", "RECUSADA"]),
  observacao: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const t = v.trim();
      return t ? t : null;
    }),
});

/** Incluir item/série em RMA aberto. */
export const adicionarRmaItemSchema = z.object({
  produtoId: z.string().uuid(),
  series: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  observacao: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const t = v.trim();
      return t ? t : null;
    }),
});

/** Remover item do RMA (estorna entrada). Motivo obrigatório (auditoria). */
export const removerRmaItemSchema = z.object({
  observacao: z
    .string()
    .max(500)
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Informe o motivo da remoção").max(500)),
});

/** Nome de arquivo do anexo — trunca nomes longos do SO (preserva extensão). */
function truncateAnexoLabel(raw: string, max = 120): string {
  const t = raw.trim();
  if (!t) return "";
  if (t.length <= max) return t;
  const dot = t.lastIndexOf(".");
  const ext =
    dot > 0 && t.length - dot <= 10 && t.length - dot > 1
      ? t.slice(dot)
      : "";
  if (ext) {
    return `${t.slice(0, Math.max(1, max - ext.length))}${ext}`;
  }
  return t.slice(0, max);
}

const anexoLabel = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v == null) return null;
    const t = truncateAnexoLabel(v);
    return t || null;
  });

export const anexarRmaSchema = z
  .object({
    tipo: z.enum(["LAUDO", "NF_ENTRADA", "NF_SAIDA", "NF_COBRANCA", "OUTRO"]),
    arquivo: uploadPath,
    label: anexoLabel,
    /** Obrigatório para LAUDO (produto + série) */
    itemId: z.string().uuid().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.tipo === "LAUDO" && !data.itemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe o item (produto/série) para anexar o laudo",
        path: ["itemId"],
      });
    }
  });

export const devolverRmaSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).optional(),
  nfSaidaNumero: z.string().max(60).optional().nullable(),
  observacao: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const t = v.trim();
      return t ? t : null;
    }),
});

/** Cancelar processo RMA — observação obrigatória (auditoria). */
export const cancelarRmaSchema = z.object({
  observacao: z
    .string()
    .max(500)
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Informe o motivo do cancelamento").max(500)),
});

/** Aloca N séries no contador (não cria UnidadeSerie — isso ocorre no lançamento). */
export const alocarSeriesSchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.coerce.number().int().min(1).max(500),
});

/** Substitui a BOM (árvore) do produto. */
export const putProdutoComponentesSchema = z.object({
  itens: z.array(produtoComponenteItemSchema).max(200),
});

/** Desfaz a última alocação pendente (reverte contador se ainda for o topo). */
export const desfazerAlocacaoSerieSchema = z.object({
  alocacaoId: z.string().uuid(),
});

/** Marca item(ns) EM_ESTOQUE como SEM_MANUTENCAO (sem mover saldo). */
export const semManutencaoRmaSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
});

/**
 * Troca: série boa vem de estoque operacional → preparação (em geral RMA),
 * sai ao cliente; série ruim vai ao estoque de descarte via transferência.
 */
export const trocarRmaItemSchema = z.object({
  itemId: z.string().uuid(),
  /** Estoque de onde sai a série boa (PLN, TBO, …) */
  origemFilialId: z.string().uuid(),
  /** Destino de preparação antes da expedição (default: filial do processo / RMA) */
  destinoPreparacaoFilialId: z.string().uuid().optional(),
  /** Número de série da peça substituta */
  numeroSerieBoa: z.string().trim().min(1).max(80),
  /** Destino da série ruim (default: estoque sigla DESC, se existir) */
  destinoDescarteFilialId: z.string().uuid().optional(),
  nfSaidaNumero: z.string().max(60).optional().nullable(),
  observacao: z.string().max(500).optional().nullable(),
});

const rmaChecklistCampoTipo = z.enum([
  "SIM_NAO",
  "TEXTO",
  "OPCAO",
  "FOTO",
]);

export const rmaChecklistTemplateItemSchema = z.object({
  codigo: z.string().trim().min(1).max(40),
  titulo: z.string().trim().min(1).max(200),
  ajuda: z.string().max(500).optional().nullable(),
  tipoCampo: rmaChecklistCampoTipo,
  obrigatorio: z.boolean().default(true),
  ordem: z.number().int().min(0).max(999).default(0),
  opcoes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  exigeFotoSe: z.string().max(40).optional().nullable(),
});

export const upsertRmaChecklistTemplateSchema = z.object({
  produtoId: z.string().uuid(),
  tipo: z.enum(["RECEBIMENTO", "LIBERACAO"]),
  nome: z.string().trim().min(1).max(120),
  ativo: z.boolean().optional().default(true),
  itens: z.array(rmaChecklistTemplateItemSchema).min(1).max(80),
});

export const clonarRmaChecklistTemplateSchema = z.object({
  produtoOrigemId: z.string().uuid(),
  produtoDestinoId: z.string().uuid(),
  tipo: z.enum(["RECEBIMENTO", "LIBERACAO"]),
  nome: z.string().trim().min(1).max(120).optional(),
});

export const salvarRmaChecklistRespostasSchema = z.object({
  respostas: z
    .array(
      z.object({
        templateItemId: z.string().uuid(),
        valorTexto: z.string().max(2000).optional().nullable(),
        valorBool: z.boolean().optional().nullable(),
        fotos: z.array(z.string().max(255)).max(10).optional(),
      })
    )
    .max(80),
});

const rmaTempoMinutosSchema = z.preprocess((v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : v;
}, z
  .number({ invalid_type_error: "Informe o tempo em minutos (número inteiro)." })
  .int("Informe o tempo em minutos (número inteiro).")
  .min(0, "O tempo em minutos não pode ser negativo.")
  .max(100_000, "Tempo em minutos acima do limite.")
  .optional()
  .nullable());

export const salvarRmaDiagnosticoPlanoSchema = z.object({
  resumoProblema: z
    .string({ required_error: "Informe o resumo do problema." })
    .trim()
    .min(1, "Informe o resumo do problema.")
    .max(2000, "O resumo do problema está longo demais (máx. 2000 caracteres)."),
  observacaoTecnica: z.string().max(4000).optional().nullable(),
  servicos: z
    .array(
      z.object({
        descricao: z
          .string()
          .trim()
          .min(1, "Informe a descrição do serviço.")
          .max(300, "Descrição do serviço está longa demais."),
        ordem: z.coerce.number().int().min(0).max(999).optional(),
        tempoMinutos: rmaTempoMinutosSchema,
      })
    )
    .max(40)
    .default([]),
  pecas: z
    .array(
      z.object({
        produtoId: z
          .string()
          .uuid({ message: "Selecione a peça na lista de produtos." }),
        quantidade: z.coerce
          .number({
            invalid_type_error: "Informe a quantidade da peça (maior que zero).",
          })
          .positive("Informe a quantidade da peça (maior que zero).")
          .max(9999, "Quantidade da peça acima do limite."),
        motivo: z.string().max(300).optional().nullable(),
      })
    )
    .max(40)
    .default([]),
});

export const salvarRmaOrcamentoSchema = z.object({
  maoDeObra: z.number().min(0).max(1_000_000).default(0),
  desconto: z.number().min(0).max(1_000_000).default(0),
  observacaoComercial: z.string().max(2000).optional().nullable(),
  linhas: z
    .array(
      z.object({
        descricao: z.string().trim().min(1).max(300),
        produtoId: z.string().uuid().optional().nullable(),
        quantidade: z.number().positive().max(9999),
        valorUnitario: z.number().min(0).max(1_000_000),
        origem: z.enum(["SERVICO", "PECA", "EXTRA"]).default("EXTRA"),
        tempoMinutos: z.number().int().min(0).max(100_000).optional().nullable(),
      })
    )
    .min(1)
    .max(60),
});

export const salvarRmaOrcamentoLoteSchema = z.object({
  itens: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        desconto: z.number().min(0).max(1_000_000).default(0),
        observacaoComercial: z.string().max(2000).optional().nullable(),
        linhas: z
          .array(
            z.object({
              descricao: z.string().trim().min(1).max(300),
              produtoId: z.string().uuid().optional().nullable(),
              quantidade: z.number().positive().max(9999),
              valorUnitario: z.number().min(0).max(1_000_000),
              origem: z.enum(["SERVICO", "PECA", "EXTRA"]).default("EXTRA"),
              tempoMinutos: z
                .number()
                .int()
                .min(0)
                .max(100_000)
                .optional()
                .nullable(),
            })
          )
          .min(1)
          .max(60),
      })
    )
    .min(1)
    .max(80),
});

export const enviarRmaOrcamentoLoteSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(80),
});

export const decidirRmaOrcamentoSchema = z.object({
  observacao: z.string().max(500).optional().nullable(),
});
