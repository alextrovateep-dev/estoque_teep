import { z } from "zod";
import {
  ALERTA_EVENTOS,
  CLIENTE_TIPOS,
  OPERACOES,
  PERFIS,
  PERMISSAO_KEYS,
} from "./constants";

const alertasEmailSchema = z
  .record(z.enum(ALERTA_EVENTOS), z.boolean())
  .default({});

const permissoesSchema = z
  .record(z.enum(PERMISSAO_KEYS), z.boolean())
  .optional();

export const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

const senhaForteSchema = z
  .string()
  .min(8, "senha deve ter no mínimo 8 caracteres")
  .regex(/[A-Z]/, "senha deve ter 1 maiúscula")
  .regex(/[0-9]/, "senha deve ter 1 número");

export const createUsuarioBaseSchema = z.object({
  nome: z.string().min(2).max(100),
  email: z.string().email().max(100),
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

export const clienteSchema = z.object({
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

export const tipoMovimentacaoObjectSchema = z.object({
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
  descricao: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
});

export const tipoMovimentacaoSchema = tipoMovimentacaoObjectSchema.superRefine(
  (data, ctx) => {
    const alerta = data.geraAlertaRetorno === true;
    const retorno = Boolean(data.ehRetornoDeId);
    const termo = data.requerTermoComodato === true;
    const arvore = data.baixaPorArvore === true;
    if ((alerta || retorno || termo) && data.requerCliente === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Tipos com alerta de retorno, vínculo de retorno ou termo de comodato devem exigir cliente",
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
  }
);
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
    observacao: z.string().optional().nullable(),
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
          tipo: z.enum(["NOTA_FISCAL", "TERMO_COMODATO", "OUTRO"]),
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
  itens: z.array(createTransferenciaItemSchema).min(1),
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
    clienteId: z.string().uuid(),
    /** Usuário comercial responsável pela aprovação com o cliente */
    responsavelComercialId: z.string().uuid({
      message: "Selecione o responsável comercial",
    }),
    observacao: z.string().max(2000).optional().nullable(),
    nfEntradaNumero: z.string().max(60).optional().nullable(),
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
          produtoId: z.string().uuid(),
          /** Uma ou mais séries; cada série vira 1 item RMA (qtd 1) */
          series: z.array(z.string().trim().min(1).max(80)).min(1).max(500),
          observacao: z.string().max(500).optional().nullable(),
        })
      )
      .min(1)
      .max(50),
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

/** NFs / observação do processo (cobrança de manutenção é por item). */
export const updateRmaFinanceiroSchema = z.object({
  nfEntradaNumero: z.string().max(60).optional().nullable(),
  nfSaidaNumero: z.string().max(60).optional().nullable(),
  observacao: z.string().max(2000).optional().nullable(),
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
