import { z } from "zod";
import {
  hasPermissao,
  resolvePermissoes,
  type PermissoesUsuario,
} from "@teep/shared";
import { AuthUser } from "../../middleware/auth";
import { AppError } from "../../middleware/error";
import { prisma } from "../../lib/prisma";
import { obterDashboard } from "../dashboardService";
import {
  relacionamentosDoCliente,
  relacionamentosDoProduto,
} from "../parceiroHistoricoService";
import { mapaQtyOcupadaPorSaidas } from "../retornoVinculoHelper";
import { gerarExportDossieProduto } from "./assistenteExportService";
import { putAssistenteExport } from "./assistenteExportTokenStore";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ToolContext = {
  user: AuthUser;
  /** Hint do filtro do dashboard (opcional) */
  filialHint?: string | null;
  /** Overrides de ACL do usuário (já resolvidos ou raw do banco) */
  permissoes?: PermissoesUsuario | Partial<Record<string, boolean>> | null;
};

function resolveFilialId(
  user: AuthUser,
  requested?: string | null,
  hint?: string | null
): string | null {
  if (user.perfil === "OPERADOR") {
    const ids =
      user.filialIds?.length > 0
        ? user.filialIds
        : user.filialId
          ? [user.filialId]
          : [];
    if (ids.length === 0) return null;
    const pick = requested || hint;
    if (pick && ids.includes(pick)) return pick;
    return user.filialId && ids.includes(user.filialId)
      ? user.filialId
      : ids[0]!;
  }
  const id = requested || hint || null;
  if (id && !UUID_RE.test(id)) {
    throw new AppError(400, "filialId inválido");
  }
  return id;
}

async function assertFilialAtiva(filialId: string): Promise<void> {
  const f = await prisma.filial.findFirst({
    where: { id: filialId, ativo: true },
    select: { id: true },
  });
  if (!f) throw new AppError(404, "Filial não encontrada");
}

const searchProductsArgs = z.object({
  q: z.string().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});

const listProductsArgs = z.object({
  orderBy: z
    .enum(["preco_desc", "preco_asc", "codigo"])
    .optional()
    .default("codigo"),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

const getProductStockArgs = z.object({
  codigoOuNome: z.string().min(1).max(120),
  filialId: z.string().uuid().optional().nullable(),
});

const listMovementsArgs = z.object({
  codigoOuNome: z.string().min(1).max(120).optional().nullable(),
  filialId: z.string().uuid().optional().nullable(),
  /** Sigla ou nome (ex.: TBO, Paulínia) — preferir quando o usuário citar a filial */
  filialSigla: z.string().min(1).max(80).optional().nullable(),
  /**
   * Como aplicar o filtro de filial:
   * - qualquer (padrão): origem OU destino
   * - origem: só filialId
   * - destino: só filialDestinoId (“transferência PARA TBO”)
   */
  papelFilial: z
    .enum(["qualquer", "origem", "destino"])
    .optional()
    .default("qualquer"),
  de: z.string().min(4).max(40).optional().nullable(),
  ate: z.string().min(4).max(40).optional().nullable(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  /** comodato | demo | alerta_retorno | retorno | transferencia */
  fluxo: z
    .enum([
      "comodato",
      "demo",
      "alerta_retorno",
      "retorno",
      "transferencia",
    ])
    .optional()
    .nullable(),
  /**
   * true = só saídas CONCLUIDAS ainda abertas (qty não totalmente retornada)
   * Use com fluxo comodato/demo/alerta_retorno para “itens em comodato/demo”.
   */
  somenteAbertos: z.boolean().optional().default(false),
});

const balanceArgs = z.object({
  filialId: z.string().uuid().optional().nullable(),
  somenteAlertas: z.boolean().optional().default(false),
});

const stockValueArgs = z.object({
  filialId: z.string().uuid().optional().nullable(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  /** Se true, agrupa por produto (soma filiais); se false, uma linha por produto×filial */
  agruparPorProduto: z.boolean().optional().default(true),
  /** valor_desc = maior capital em estoque; preco_desc = maior preço unitário entre itens com saldo */
  orderBy: z.enum(["valor_desc", "preco_desc"]).optional().default("valor_desc"),
  /** Inclui última movimentação + usuário de cada item do ranking */
  incluirUltimaMovimentacao: z.boolean().optional().default(true),
});

const partnerProductsArgs = z.object({
  nome: z.string().min(1).max(120),
});

const productPartnersArgs = z.object({
  codigoOuNome: z.string().min(1).max(120),
});

const exportProductReportArgs = z.object({
  codigoOuNome: z.string().min(1).max(120),
  format: z.enum(["pdf", "xlsx"]),
  filialId: z.string().uuid().optional().nullable(),
});

const prepareTransferArgs = z.object({
  origem: z.string().min(1).max(80),
  destino: z.string().min(1).max(80),
  codigoOuNome: z.string().min(1).max(120),
  quantidade: z.coerce.number().positive().max(1_000_000),
});

export const TOOL_DEFINITIONS = [
  {
    name: "list_stock_by_value",
    description:
      "Ranking de itens COM saldo. orderBy=valor_desc → maior valor (qty×preço). orderBy=preco_desc → maior preço unitário entre quem tem estoque. Por padrão inclui ultimaMovimentacao (data, tipo, qty, usuarioNome). Use para perguntas compostas sobre o item e a última movimentação dele.",
    parameters: {
      type: "object",
      properties: {
        filialId: {
          type: "string",
          description: "UUID da filial; omitir = consolidado (Admin/Gerente)",
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        agruparPorProduto: {
          type: "boolean",
          description:
            "true (padrão) = soma valor do produto em todas as filiais; false = ranking por posição filial",
        },
        orderBy: {
          type: "string",
          enum: ["valor_desc", "preco_desc"],
          description:
            "valor_desc = capital em estoque; preco_desc = preço unitário (só produtos com saldo > 0)",
        },
        incluirUltimaMovimentacao: {
          type: "boolean",
          description: "Padrão true — última movimentação daquele produto + usuário",
        },
      },
    },
  },
  {
    name: "list_products",
    description:
      "Lista produtos do CADASTRO com preço unitário de tabela. Use só para 'mais caro/barato na tabela de preços' ou catálogo. NÃO use para valor em estoque.",
    parameters: {
      type: "object",
      properties: {
        orderBy: {
          type: "string",
          enum: ["preco_desc", "preco_asc", "codigo"],
          description:
            "preco_desc = preço de tabela maior; preco_asc = menor; codigo = alfabético",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
        },
      },
    },
  },
  {
    name: "search_products",
    description:
      "Busca produtos ativos por código ou descrição (inclui preço de tabela). Use quando o usuário citar um SKU ou nome parcial.",
    parameters: {
      type: "object",
      properties: {
        q: { type: "string", description: "Trecho de código ou descrição" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["q"],
    },
  },
  {
    name: "get_product_stock",
    description:
      "Saldos e valor (saldo×preço) de um produto por filial. Se o produto existe mas não tem posição, retorna saldo 0.",
    parameters: {
      type: "object",
      properties: {
        codigoOuNome: { type: "string" },
        filialId: {
          type: "string",
          description: "UUID da filial; omitir para consolidado (Admin/Gerente)",
        },
      },
      required: ["codigoOuNome"],
    },
  },
  {
    name: "list_stock_movements",
    description:
      "Lista movimentações (máx. 50). CONSULTAR transferência: fluxo=transferencia (+ filialSigla + papelFilial=destino|origem; de/ate = janela de ‘hoje’ do system prompt). Resposta traz contagemEnviadas (use ao contar). NÃO use fluxo=retorno. Comodato/demo: fluxo=comodato|demo|alerta_retorno|retorno; somenteAbertos=true para itens ainda fora.",
    parameters: {
      type: "object",
      properties: {
        codigoOuNome: {
          type: "string",
          description: "Obrigatório se a pergunta for de um produto específico",
        },
        filialId: { type: "string", description: "UUID da filial (opcional)" },
        filialSigla: {
          type: "string",
          description:
            "Sigla/nome da filial citada pelo usuário (ex.: TBO, PLN). Preferir em vez de UUID.",
        },
        papelFilial: {
          type: "string",
          enum: ["qualquer", "origem", "destino"],
          description:
            "destino = transferência/movimentação PARA aquela filial; origem = DE; qualquer = ambos",
        },
        de: {
          type: "string",
          description:
            "ISO início (ex. início do dia SP: 2026-07-30T03:00:00.000Z para 30/07)",
        },
        ate: { type: "string", description: "ISO fim" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        fluxo: {
          type: "string",
          enum: [
            "comodato",
            "demo",
            "alerta_retorno",
            "retorno",
            "transferencia",
          ],
          description:
            "transferencia = Enviada/Recebida/entre estoques; comodato/demo/retorno = tipos de alerta/retorno. Nunca misture.",
        },
        somenteAbertos: {
          type: "boolean",
          description:
            "true = só saídas concluídas ainda abertas (falta retornar). Ideal para 'temos itens em comodato/demo?'",
        },
      },
    },
  },
  {
    name: "get_inventory_balance",
    description:
      "Resumo: KPIs (inclui valorTotal acumulado do estoque) e alertas mín/máx. Use para 'valor total acumulado', visão geral, abaixo do mínimo.",
    parameters: {
      type: "object",
      properties: {
        filialId: { type: "string" },
        somenteAlertas: { type: "boolean" },
      },
    },
  },
  {
    name: "get_partner_products",
    description:
      "Histórico real de um cliente OU fornecedor pelo nome: comprados = produtos que NÓS compramos dele (ENTRADA de compra); vendidos = produtos que NÓS enviamos/vendemos a ele (SAIDA). Ignora estornos e devoluções. Use para 'o que a Facchini já comprou', 'o que já compramos do fornecedor X'.",
    parameters: {
      type: "object",
      properties: {
        nome: {
          type: "string",
          description: "Nome (ou trecho) do cliente/fornecedor",
        },
      },
      required: ["nome"],
    },
  },
  {
    name: "get_product_partners",
    description:
      "Histórico real de um produto: fornecedores = de quem NÓS já compramos (ENTRADA de compra); clientes = para quem NÓS já vendemos/enviamos (SAIDA). Ignora estornos e devoluções. Use para 'quem fornece o produto X', 'quais clientes já compraram Y'.",
    parameters: {
      type: "object",
      properties: {
        codigoOuNome: {
          type: "string",
          description: "Código ou descrição do produto",
        },
      },
      required: ["codigoOuNome"],
    },
  },
  {
    name: "export_product_report",
    description:
      "Gera arquivo PDF ou Excel (dossiê) de um produto: estoque por filial, fornecedores e clientes. Use quando o usuário pedir para exportar, baixar, gerar PDF/Excel ou relatório em arquivo. NÃO diga que não consegue exportar — chame esta tool. O botão de download aparece na UI.",
    parameters: {
      type: "object",
      properties: {
        codigoOuNome: {
          type: "string",
          description: "Código ou descrição do produto (use o SKU da conversa)",
        },
        format: {
          type: "string",
          enum: ["pdf", "xlsx"],
          description: "pdf = PDF; xlsx = Excel",
        },
        filialId: {
          type: "string",
          description: "UUID da filial; omitir = consolidado (Admin/Gerente)",
        },
      },
      required: ["codigoOuNome", "format"],
    },
  },
  {
    name: "prepare_transfer",
    description:
      "Só para CRIAR intenção de transferência (usuário quer transferir agora). NÃO use para consultar histórico (‘teve transferência?’). quantidade = número EXATO pedido pelo usuário (se pediu 20, passe 20 — nunca o saldo). Prepara atalho Novo Lançamento. NÃO diga Confirmar Recebimento para criar. Retorna actionLink + saldo. Usuário ainda confirma.",
    parameters: {
      type: "object",
      properties: {
        origem: {
          type: "string",
          description: "Sigla ou nome da filial de origem (ex.: PLN, Paulínia)",
        },
        destino: {
          type: "string",
          description: "Sigla ou nome da filial de destino (ex.: TBO, Timbó)",
        },
        codigoOuNome: {
          type: "string",
          description: "Código ou descrição do produto",
        },
        quantidade: {
          type: "number",
          description:
            "EXATAMENTE a quantidade que o usuário pediu (ex.: pediu 20 → 20). NUNCA use saldoAtual/disponível no lugar da quantidade pedida.",
        },
      },
      required: ["origem", "destino", "codigoOuNome", "quantidade"],
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext
): Promise<unknown> {
  switch (name) {
    case "list_stock_by_value":
      return listStockByValue(stockValueArgs.parse(rawArgs), ctx);
    case "list_products":
      return listProducts(listProductsArgs.parse(rawArgs));
    case "search_products":
      return searchProducts(searchProductsArgs.parse(rawArgs));
    case "get_product_stock":
      return getProductStock(getProductStockArgs.parse(rawArgs), ctx);
    case "list_stock_movements":
      return listStockMovements(listMovementsArgs.parse(rawArgs), ctx);
    case "get_inventory_balance":
      return getInventoryBalance(balanceArgs.parse(rawArgs), ctx);
    case "get_partner_products":
      return getPartnerProducts(partnerProductsArgs.parse(rawArgs));
    case "get_product_partners":
      return getProductPartners(productPartnersArgs.parse(rawArgs));
    case "export_product_report":
      return exportProductReport(exportProductReportArgs.parse(rawArgs), ctx);
    case "prepare_transfer":
      return prepareTransfer(prepareTransferArgs.parse(rawArgs), ctx);
    default:
      return { error: `Tool desconhecida: ${name}` };
  }
}

async function findFilialBySiglaOuNome(qRaw: string) {
  const q = qRaw.trim();
  if (!q) return null;
  const exactSigla = await prisma.filial.findFirst({
    where: { ativo: true, sigla: { equals: q, mode: "insensitive" } },
    select: { id: true, sigla: true, nome: true },
  });
  if (exactSigla) return exactSigla;
  const byNome = await prisma.filial.findFirst({
    where: {
      ativo: true,
      OR: [
        { nome: { equals: q, mode: "insensitive" } },
        { nome: { contains: q, mode: "insensitive" } },
        { sigla: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, sigla: true, nome: true },
    orderBy: { sigla: "asc" },
  });
  return byNome;
}

async function prepareTransfer(
  args: z.infer<typeof prepareTransferArgs>,
  ctx: ToolContext
) {
  const perms = resolvePermissoes(ctx.user.perfil, ctx.permissoes ?? null);
  if (!hasPermissao(ctx.user.perfil, perms, "lancamentos")) {
    return {
      ok: false,
      error:
        "Usuário sem permissão de Novo Lançamento. Não prepare atalho nem diga que há botão — oriente a pedir acesso ao Admin.",
    };
  }

  const origem = await findFilialBySiglaOuNome(args.origem);
  if (!origem) {
    return {
      ok: false,
      error: `Filial de origem não encontrada: “${args.origem}”`,
    };
  }
  const destino = await findFilialBySiglaOuNome(args.destino);
  if (!destino) {
    return {
      ok: false,
      error: `Filial de destino não encontrada: “${args.destino}”`,
    };
  }
  if (origem.id === destino.id) {
    return { ok: false, error: "Origem e destino devem ser filiais diferentes" };
  }

  if (ctx.user.perfil === "OPERADOR") {
    const ids =
      ctx.user.filialIds?.length > 0
        ? ctx.user.filialIds
        : ctx.user.filialId
          ? [ctx.user.filialId]
          : [];
    if (!ids.includes(origem.id)) {
      return {
        ok: false,
        error: "Operador só pode transferir a partir da própria filial",
      };
    }
  }

  const produto = await findProdutoByCodigoOuNome(args.codigoOuNome);
  if (!produto) {
    return {
      ok: false,
      error: `Produto não encontrado: “${args.codigoOuNome}”`,
    };
  }

  const est = await prisma.estoque.findUnique({
    where: {
      uniq_produto_filial: { produtoId: produto.id, filialId: origem.id },
    },
    select: { saldoAtual: true },
  });
  const saldoOrigem = Number(est?.saldoAtual ?? 0);
  const reservada = await prisma.transferenciaItem.aggregate({
    where: {
      produtoId: produto.id,
      transferencia: {
        status: "PENDENTE_APROVACAO",
        origemFilialId: origem.id,
      },
    },
    _sum: { qtdEnviada: true },
  });
  const qtyReservada = Number(reservada._sum.qtdEnviada ?? 0);
  const disponivel = saldoOrigem - qtyReservada;
  const qtd = Number(args.quantidade);
  if (qtd > disponivel + 1e-9) {
    return {
      ok: false,
      error: `Saldo insuficiente em ${origem.sigla}: disponível ${disponivel}${
        qtyReservada > 0 ? ` (reservado pendente: ${qtyReservada})` : ""
      }, pedido ${qtd}`,
      produtoCodigo: produto.codigo,
      saldoOrigem,
      qtyReservada,
      disponivel,
      origem: origem.sigla,
      destino: destino.sigla,
    };
  }

  const qs = new URLSearchParams({
    transf: "1",
    origem: origem.sigla,
    destino: destino.sigla,
    codigo: produto.codigo,
    qtd: String(qtd),
  });
  const href = `/lancamentos/novo?${qs.toString()}`;
  const label = `Abrir transferência ${origem.sigla} → ${destino.sigla} · ${produto.codigo} × ${qtd}`;

  return {
    ok: true,
    mensagem:
      "Atalho pronto. Avise o usuário para clicar no botão abaixo — a tela Novo Lançamento abre com a transferência preenchida. Ele ainda precisa confirmar o lançamento. Confirmar Recebimento é só para conferir o que já chegou.",
    actionLink: { href, label },
    resumo: {
      produtoCodigo: produto.codigo,
      produtoDescricao: produto.descricao,
      quantidade: qtd,
      origemSigla: origem.sigla,
      origemNome: origem.nome,
      destinoSigla: destino.sigla,
      destinoNome: destino.nome,
      saldoOrigem,
      qtyReservada,
      disponivel,
      saldoApos: Math.max(0, disponivel - qtd),
    },
  };
}

async function exportProductReport(
  args: z.infer<typeof exportProductReportArgs>,
  ctx: ToolContext
) {
  try {
    const { buffer, filename, label, dossie } = await gerarExportDossieProduto(
      ctx.user,
      args.codigoOuNome,
      args.format,
      { filialId: args.filialId, filialHint: ctx.filialHint }
    );
    const downloadToken = putAssistenteExport({
      userId: ctx.user.id,
      buffer,
      filename,
      format: args.format,
      label,
    });
    return {
      ok: true,
      format: args.format,
      filename,
      downloadToken,
      label,
      produto: {
        codigo: dossie.produto.codigo,
        descricao: dossie.produto.descricao,
      },
      resumo: {
        qtyTotal: dossie.qtyTotal,
        valorTotal: dossie.valorTotal,
        fornecedores: dossie.fornecedores.length,
        clientes: dossie.clientes.length,
        filiaisComSaldo: dossie.saldos.filter((s) => s.qty > 0).length,
      },
      mensagem:
        "Arquivo gerado. O botão de download aparece abaixo da resposta na interface. Avise o usuário para clicar em Baixar PDF ou Baixar Excel.",
    };
  } catch (e) {
    if (e instanceof AppError) {
      return { ok: false, error: e.message };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha ao gerar exportação",
    };
  }
}

async function listStockByValue(
  args: z.infer<typeof stockValueArgs>,
  ctx: ToolContext
) {
  const filialId = resolveFilialId(ctx.user, args.filialId, ctx.filialHint);
  if (filialId) await assertFilialAtiva(filialId);

  const rows = await prisma.estoque.findMany({
    where: {
      ...(filialId ? { filialId } : {}),
      saldoAtual: { gt: 0 },
      produto: { ativo: true },
    },
    select: {
      saldoAtual: true,
      filial: { select: { sigla: true, nome: true } },
      produto: {
        select: {
          codigo: true,
          descricao: true,
          unidade: true,
          precoUnitario: true,
        },
      },
    },
  });

  type Pos = {
    codigo: string;
    descricao: string;
    unidade: string;
    filialSigla: string | null;
    qty: number;
    precoUnitario: number;
    valorEstoque: number;
  };

  const positions: Pos[] = rows.map((e) => {
    const qty = Number(e.saldoAtual);
    const preco = Number(e.produto.precoUnitario);
    return {
      codigo: e.produto.codigo,
      descricao: e.produto.descricao,
      unidade: e.produto.unidade,
      filialSigla: e.filial.sigla,
      qty,
      precoUnitario: preco,
      valorEstoque: Math.round(qty * preco * 100) / 100,
    };
  });

  let ranking: Pos[];
  if (args.agruparPorProduto) {
    const map = new Map<string, Pos>();
    for (const p of positions) {
      const cur = map.get(p.codigo);
      if (!cur) {
        map.set(p.codigo, {
          ...p,
          filialSigla: null,
        });
      } else {
        cur.qty += p.qty;
        cur.valorEstoque =
          Math.round((cur.valorEstoque + p.valorEstoque) * 100) / 100;
      }
    }
    ranking = [...map.values()];
  } else {
    ranking = positions;
  }

  ranking.sort((a, b) =>
    args.orderBy === "preco_desc"
      ? b.precoUnitario - a.precoUnitario || b.valorEstoque - a.valorEstoque
      : b.valorEstoque - a.valorEstoque
  );
  const top = ranking.slice(0, args.limit);
  const valorTotal =
    Math.round(positions.reduce((s, p) => s + p.valorEstoque, 0) * 100) / 100;

  let rankingOut: Array<
    Pos & {
      ultimaMovimentacao?: {
        data: string;
        tipo: string;
        operacao: string;
        qty: number;
        status: string;
        filial: string;
        filialDestino: string | null;
        usuarioNome: string;
        usuarioEmail: string;
      } | null;
    }
  > = top;

  if (args.incluirUltimaMovimentacao && top.length > 0) {
    rankingOut = await Promise.all(
      top.map(async (item) => {
        const prod = await prisma.produto.findFirst({
          where: { codigo: item.codigo, ativo: true },
          select: { id: true },
        });
        if (!prod) return { ...item, ultimaMovimentacao: null };
        const m = await prisma.movimentacao.findFirst({
          where: {
            produtoId: prod.id,
            ...(filialId
              ? {
                  OR: [{ filialId }, { filialDestinoId: filialId }],
                }
              : {}),
          },
          orderBy: { dataMovimento: "desc" },
          select: {
            dataMovimento: true,
            quantidade: true,
            status: true,
            tipo: { select: { nome: true, operacao: true } },
            filial: { select: { sigla: true } },
            filialDestino: { select: { sigla: true } },
            usuario: { select: { nome: true, email: true } },
          },
        });
        return {
          ...item,
          ultimaMovimentacao: m
            ? {
                data: m.dataMovimento.toISOString(),
                tipo: m.tipo.nome,
                operacao: m.tipo.operacao,
                qty: Number(m.quantidade),
                status: m.status,
                filial: m.filial.sigla,
                filialDestino: m.filialDestino?.sigla ?? null,
                usuarioNome: m.usuario.nome,
                usuarioEmail: m.usuario.email,
              }
            : null,
        };
      })
    );
  }

  return {
    asOf: new Date().toISOString(),
    formula: "valorEstoque = saldoAtual × precoUnitario",
    orderBy: args.orderBy,
    agruparPorProduto: args.agruparPorProduto,
    valorTotalEstoque: valorTotal,
    encontrados: rankingOut.length,
    ranking: rankingOut,
  };
}

async function listProducts(args: z.infer<typeof listProductsArgs>) {
  const orderBy =
    args.orderBy === "preco_desc"
      ? ({ precoUnitario: "desc" } as const)
      : args.orderBy === "preco_asc"
        ? ({ precoUnitario: "asc" } as const)
        : ({ codigo: "asc" } as const);

  const rows = await prisma.produto.findMany({
    where: { ativo: true },
    select: {
      codigo: true,
      descricao: true,
      unidade: true,
      precoUnitario: true,
      categoria: { select: { nome: true } },
    },
    take: args.limit,
    orderBy,
  });

  return {
    orderBy: args.orderBy,
    encontrados: rows.length,
    produtos: rows.map((p) => ({
      codigo: p.codigo,
      descricao: p.descricao,
      unidade: p.unidade,
      precoUnitario: Number(p.precoUnitario),
      categoria: p.categoria.nome,
    })),
  };
}

async function searchProducts(args: z.infer<typeof searchProductsArgs>) {
  const q = args.q.trim();
  const rows = await prisma.produto.findMany({
    where: {
      ativo: true,
      OR: [
        { codigo: { contains: q, mode: "insensitive" } },
        { descricao: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      codigo: true,
      descricao: true,
      unidade: true,
      precoUnitario: true,
      categoria: { select: { nome: true } },
    },
    take: args.limit,
    orderBy: { codigo: "asc" },
  });
  return {
    encontrados: rows.length,
    produtos: rows.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      descricao: p.descricao,
      unidade: p.unidade,
      precoUnitario: Number(p.precoUnitario),
      categoria: p.categoria.nome,
    })),
  };
}

async function findProdutoByCodigoOuNome(codigoOuNome: string) {
  const q = codigoOuNome.trim();
  const select = {
    id: true,
    codigo: true,
    descricao: true,
    unidade: true,
    precoUnitario: true,
  } as const;
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

  // "fonte de 12V" → tokens fonte + 12V (ignora palavras curtas)
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

async function getProductStock(
  args: z.infer<typeof getProductStockArgs>,
  ctx: ToolContext
) {
  const filialId = resolveFilialId(ctx.user, args.filialId, ctx.filialHint);
  if (filialId) await assertFilialAtiva(filialId);

  const produto = await findProdutoByCodigoOuNome(args.codigoOuNome);
  if (!produto) {
    return { encontrado: false, mensagem: "Produto não encontrado no cadastro" };
  }

  const preco = Number(produto.precoUnitario);
  const estoques = await prisma.estoque.findMany({
    where: {
      produtoId: produto.id,
      ...(filialId ? { filialId } : {}),
    },
    select: {
      saldoAtual: true,
      filial: { select: { sigla: true, nome: true } },
    },
    orderBy: { filial: { sigla: "asc" } },
  });

  const saldos = estoques.map((e) => {
    const qty = Number(e.saldoAtual);
    return {
      filialSigla: e.filial.sigla,
      filialNome: e.filial.nome,
      qty,
      valorEstoque: Math.round(qty * preco * 100) / 100,
    };
  });
  const qtyTotal = saldos.reduce((s, r) => s + r.qty, 0);
  const valorTotal = Math.round(qtyTotal * preco * 100) / 100;

  return {
    encontrado: true,
    asOf: new Date().toISOString(),
    produto: {
      codigo: produto.codigo,
      descricao: produto.descricao,
      unidade: produto.unidade,
      precoUnitario: preco,
    },
    saldos,
    qtyTotal,
    valorTotal,
    mensagem:
      saldos.length === 0 || qtyTotal === 0
        ? "Produto cadastrado, mas sem saldo em estoque (qty 0)."
        : undefined,
  };
}

async function listStockMovements(
  args: z.infer<typeof listMovementsArgs>,
  ctx: ToolContext
) {
  const fluxo = args.fluxo || null;
  const papel = args.papelFilial || "qualquer";
  /** Transferência ≠ saída aberta de demo/comodato — ignora somenteAbertos se misturado. */
  const somenteAbertos =
    fluxo === "transferencia" ? false : Boolean(args.somenteAbertos);

  const opIds =
    ctx.user.perfil === "OPERADOR"
      ? ctx.user.filialIds?.length > 0
        ? ctx.user.filialIds
        : ctx.user.filialId
          ? [ctx.user.filialId]
          : []
      : null;

  let filialId: string | null = null;
  /** Operador pergunta “para TBO” sem ter TBO no vínculo — filtra destino + origem nas suas. */
  let destinoForaDoEscopoOperador = false;

  if (args.filialSigla?.trim()) {
    const bySigla = await findFilialBySiglaOuNome(args.filialSigla);
    if (!bySigla) {
      return {
        encontrados: 0,
        movimentacoes: [],
        mensagem: `Filial não encontrada: “${args.filialSigla}”`,
      };
    }
    if (opIds) {
      if (opIds.includes(bySigla.id)) {
        filialId = bySigla.id;
      } else if (papel === "destino") {
        destinoForaDoEscopoOperador = true;
        filialId = bySigla.id;
      } else {
        return {
          encontrados: 0,
          movimentacoes: [],
          mensagem: "Operador sem acesso a esta filial",
        };
      }
    } else {
      filialId = bySigla.id;
    }
  } else if (args.filialId) {
    filialId = resolveFilialId(ctx.user, args.filialId, null);
  } else if (fluxo === "transferencia" && !opIds) {
    // Admin/Gerente em consulta de transferência: não herdar filtro do dashboard
    filialId = null;
  } else {
    filialId = resolveFilialId(ctx.user, null, ctx.filialHint);
  }

  if (filialId) await assertFilialAtiva(filialId);

  let produtoId: string | undefined;
  if (args.codigoOuNome) {
    const p = await findProdutoByCodigoOuNome(args.codigoOuNome);
    if (!p) {
      return {
        encontrados: 0,
        movimentacoes: [],
        mensagem: "Produto não encontrado",
      };
    }
    produtoId = p.id;
  }

  const de = args.de ? new Date(args.de) : undefined;
  const ate = args.ate ? new Date(args.ate) : undefined;

  const tipoWhere: Record<string, unknown> = {};
  if (fluxo === "comodato") {
    tipoWhere.OR = [
      { nome: { contains: "comodato", mode: "insensitive" } },
      { nome: { contains: "comodado", mode: "insensitive" } },
      { requerTermoComodato: true },
    ];
  } else if (fluxo === "demo") {
    tipoWhere.OR = [
      { nome: { contains: "demo", mode: "insensitive" } },
      { nome: { contains: "demonstr", mode: "insensitive" } },
    ];
  } else if (fluxo === "alerta_retorno") {
    tipoWhere.geraAlertaRetorno = true;
  } else if (fluxo === "retorno") {
    tipoWhere.OR = [
      { ehRetornoDeId: { not: null } },
      { nome: { contains: "retorno", mode: "insensitive" } },
    ];
  } else if (fluxo === "transferencia") {
    // Ledger: "Transferência Enviada" (SAIDA) / "Recebida" (ENTRADA) + tipo manual TRANSFERENCIA
    tipoWhere.OR = [
      { operacao: "TRANSFERENCIA" },
      { nome: { contains: "transfer", mode: "insensitive" } },
    ];
  } else if (somenteAbertos) {
    // “itens em comodato/demo?” sem fluxo explícito → saídas com alerta de retorno
    tipoWhere.geraAlertaRetorno = true;
  }

  const takePool = somenteAbertos
    ? Math.min(100, Math.max(args.limit * 4, 40))
    : args.limit;

  let filialWhere: Record<string, unknown> | undefined;
  if (destinoForaDoEscopoOperador && filialId && opIds?.length) {
    filialWhere = {
      filialDestinoId: filialId,
      filialId: { in: opIds },
    };
  } else if (filialId) {
    if (papel === "origem") filialWhere = { filialId };
    else if (papel === "destino") filialWhere = { filialDestinoId: filialId };
    else filialWhere = { OR: [{ filialId }, { filialDestinoId: filialId }] };
  } else if (opIds?.length && fluxo === "transferencia") {
    filialWhere = {
      OR: [{ filialId: { in: opIds } }, { filialDestinoId: { in: opIds } }],
    };
  }

  const rows = await prisma.movimentacao.findMany({
    where: {
      ...(produtoId ? { produtoId } : {}),
      ...(filialWhere || {}),
      ...(de || ate
        ? {
            dataMovimento: {
              ...(de ? { gte: de } : {}),
              ...(ate ? { lte: ate } : {}),
            },
          }
        : {}),
      ...(somenteAbertos
        ? { operacao: "SAIDA", status: "CONCLUIDO", estornoDeId: null }
        : {}),
      ...(Object.keys(tipoWhere).length > 0 ? { tipo: tipoWhere } : {}),
    },
    select: {
      id: true,
      quantidade: true,
      status: true,
      dataMovimento: true,
      produto: { select: { codigo: true, descricao: true } },
      tipo: {
        select: {
          nome: true,
          operacao: true,
          geraAlertaRetorno: true,
          requerTermoComodato: true,
          ehRetornoDeId: true,
          diasAlerta: true,
        },
      },
      filial: { select: { sigla: true } },
      filialDestino: { select: { sigla: true } },
      cliente: { select: { nome: true } },
      usuario: { select: { nome: true, email: true } },
      alertasRetorno: {
        select: {
          dias: true,
          agendadoPara: true,
          enviadoEm: true,
          canceladoEm: true,
        },
        orderBy: { dias: "asc" },
      },
    },
    orderBy: { dataMovimento: "desc" },
    take: takePool,
  });

  let ocupadaMap = new Map<string, number>();
  if (somenteAbertos && rows.length > 0) {
    ocupadaMap = await mapaQtyOcupadaPorSaidas(
      prisma,
      rows.map((r) => r.id)
    );
  }

  const fmtSp = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
    }).format(d);

  /** DATE civil (coluna date / UTC midnight do dia SP) → dd/mm/aaaa sem shift de fuso. */
  const fmtCivilUtc = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${day}/${m}/${y}`;
  };

  const movimentacoes: Array<Record<string, unknown>> = [];
  for (const m of rows) {
    const qty = Number(m.quantidade);
    let qtyRestante: number | undefined;
    if (somenteAbertos) {
      qtyRestante = Math.max(0, qty - (ocupadaMap.get(m.id) || 0));
      if (qtyRestante <= 1e-9) continue;
    }

    const diasConfig = Array.isArray(m.tipo.diasAlerta)
      ? (m.tipo.diasAlerta as unknown[])
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      : [];

    const alertasRetorno = m.alertasRetorno.map((a) => ({
      diasAposEnvio: a.dias,
      dataAgendada: fmtCivilUtc(a.agendadoPara),
      dataAgendadaIso: a.agendadoPara.toISOString().slice(0, 10),
      enviado: Boolean(a.enviadoEm),
      cancelado: Boolean(a.canceladoEm),
      status: a.canceladoEm
        ? "cancelado"
        : a.enviadoEm
          ? "enviado"
          : "pendente",
    }));

    const ehTransferencia =
      m.tipo.operacao === "TRANSFERENCIA" ||
      Boolean(m.filialDestino) ||
      /transfer/i.test(m.tipo.nome);

    let papelNaTransferencia: "enviada" | "recebida" | null = null;
    if (ehTransferencia) {
      if (m.filialDestino || /enviad/i.test(m.tipo.nome)) {
        papelNaTransferencia = "enviada";
      } else if (/recebid/i.test(m.tipo.nome)) {
        papelNaTransferencia = "recebida";
      }
    }

    movimentacoes.push({
      id: m.id,
      data: m.dataMovimento.toISOString(),
      dataMovimentoSp: fmtSp(m.dataMovimento),
      tipo: m.tipo.nome,
      operacao: m.tipo.operacao,
      qty,
      ...(qtyRestante != null ? { qtyRestante } : {}),
      status: m.status,
      produtoCodigo: m.produto.codigo,
      produtoDescricao: m.produto.descricao,
      filial: m.filial.sigla,
      filialDestino: m.filialDestino?.sigla ?? null,
      sentido: m.filialDestino
        ? `${m.filial.sigla} → ${m.filialDestino.sigla}`
        : m.filial.sigla,
      ehTransferencia,
      papelNaTransferencia,
      clienteNome: m.cliente?.nome ?? null,
      usuarioNome: m.usuario.nome,
      usuarioEmail: m.usuario.email,
      geraAlertaRetorno: m.tipo.geraAlertaRetorno,
      requerTermoComodato: m.tipo.requerTermoComodato,
      ehRetorno: Boolean(m.tipo.ehRetornoDeId),
      /** Dias configurados no tipo (ex.: 15,30,45,60) a partir da data do envio */
      diasAlertaConfig: diasConfig,
      /** Agenda real gravada (calendário America/Sao_Paulo) */
      alertasRetorno,
    });
    if (movimentacoes.length >= args.limit) break;
  }

  const contagemEnviadas = movimentacoes.filter(
    (m) => m.papelNaTransferencia === "enviada"
  ).length;
  const contagemRecebidas = movimentacoes.filter(
    (m) => m.papelNaTransferencia === "recebida"
  ).length;

  return {
    encontrados: movimentacoes.length,
    /** Use este número ao responder “quantas transferências” (evita dobrar Enviada+Recebida). */
    contagemEnviadas,
    contagemRecebidas,
    filtro: {
      fluxo: fluxo || null,
      somenteAbertos,
      produtoId: produtoId || null,
      filialId: filialId || null,
      filialSigla: args.filialSigla || null,
      papelFilial: papel,
      destinoForaDoEscopoOperador,
    },
    aviso:
      !produtoId && movimentacoes.length > 0 && !fluxo && !somenteAbertos
        ? "Sem codigoOuNome: lista é global (vários produtos). Para um SKU específico, passe codigoOuNome. Transferências: olhe ehTransferencia/sentido/papelNaTransferencia."
        : somenteAbertos && movimentacoes.length === 0
          ? "Nenhuma saída aberta (demo/comodato) com saldo a retornar nos filtros."
          : fluxo === "transferencia" && movimentacoes.length === 0
            ? "Nenhuma transferência no filtro (Enviada/Recebida/entre estoques)."
            : fluxo === "transferencia" &&
                contagemEnviadas > 0 &&
                contagemRecebidas > 0
              ? `Há Enviada (${contagemEnviadas}) e Recebida (${contagemRecebidas}). Ao contar eventos use contagemEnviadas.`
              : undefined,
    movimentacoes,
  };
}

async function getInventoryBalance(
  args: z.infer<typeof balanceArgs>,
  ctx: ToolContext
) {
  const filialId = resolveFilialId(ctx.user, args.filialId, ctx.filialHint);
  if (filialId) await assertFilialAtiva(filialId);

  const dash = await obterDashboard(ctx.user, filialId);
  const alertas = (dash.alertas || []).slice(0, 15).map((a) => ({
    codigo: a.codigo,
    descricao: a.descricao,
    filialSigla: a.filialSigla,
    saldoAtual: a.saldoAtual,
    estoqueMinimo: a.estoqueMinimo,
    estoqueMaximo: a.estoqueMaximo,
    tipo: a.tipo,
  }));

  return {
    asOf: new Date().toISOString(),
    escopo: dash.escopo,
    kpis: {
      posicoesComSaldo: dash.kpis.posicoesComSaldo,
      skusComSaldo: dash.kpis.skusComSaldo,
      quantidadeTotal: dash.kpis.quantidadeTotal,
      valorTotal: dash.kpis.valorTotal,
      alertasMinimo: dash.kpis.alertasMinimo,
      alertasMaximo: dash.kpis.alertasMaximo,
      movimentosHoje: dash.kpis.movimentosHoje,
      pendentes: dash.kpis.pendentes,
    },
    alertas: args.somenteAlertas
      ? alertas
      : alertas.slice(0, 10),
    alertasMeta: dash.alertasMeta,
  };
}

async function findClienteByNome(nome: string) {
  const q = nome.trim();
  const exact = await prisma.cliente.findMany({
    where: { nome: { equals: q, mode: "insensitive" } },
    select: { id: true, nome: true, tipo: true, ativo: true },
    take: 5,
    orderBy: { nome: "asc" },
  });
  if (exact.length === 1) return { match: exact[0]!, ambiguos: [] as typeof exact };
  if (exact.length > 1) {
    return { match: null, ambiguos: exact };
  }
  const partial = await prisma.cliente.findMany({
    where: { nome: { contains: q, mode: "insensitive" } },
    select: { id: true, nome: true, tipo: true, ativo: true },
    take: 5,
    orderBy: { nome: "asc" },
  });
  if (partial.length === 1) {
    return { match: partial[0]!, ambiguos: [] as typeof partial };
  }
  if (partial.length > 1) {
    return { match: null, ambiguos: partial };
  }
  return { match: null, ambiguos: [] as typeof partial };
}

async function getPartnerProducts(args: z.infer<typeof partnerProductsArgs>) {
  const { match, ambiguos } = await findClienteByNome(args.nome);
  if (ambiguos.length > 1) {
    return {
      encontrado: false,
      ambiguo: true,
      mensagem: "Mais de um cliente/fornecedor corresponde ao nome. Peça para especificar.",
      candidatos: ambiguos.map((p) => ({
        nome: p.nome,
        tipo: p.tipo,
        ativo: p.ativo,
      })),
    };
  }
  if (!match) {
    return {
      encontrado: false,
      mensagem: "Cliente/fornecedor não encontrado no cadastro",
    };
  }
  const rel = await relacionamentosDoCliente(match.id);
  return {
    encontrado: true,
    parceiro: {
      nome: match.nome,
      tipo: match.tipo,
      ativo: match.ativo,
    },
    explicacao: {
      comprados:
        "Produtos que NÓS compramos deste cadastro (ENTRADA concluída de compra; ignora estorno e devolução)",
      vendidos:
        "Produtos que NÓS vendemos/enviamos a este cadastro (SAIDA concluída; ignora estorno e devolução)",
    },
    comprados: rel.comprados,
    vendidos: rel.vendidos,
  };
}

async function getProductPartners(args: z.infer<typeof productPartnersArgs>) {
  const produto = await findProdutoByCodigoOuNome(args.codigoOuNome);
  if (!produto) {
    return { encontrado: false, mensagem: "Produto não encontrado no cadastro" };
  }
  const rel = await relacionamentosDoProduto(produto.id);
  return {
    encontrado: true,
    produto: {
      codigo: produto.codigo,
      descricao: produto.descricao,
      unidade: produto.unidade,
    },
    explicacao: {
      fornecedores:
        "Cadastros de quem NÓS já compramos este produto (ENTRADA de compra concluída; ignora estorno/devolução)",
      clientes:
        "Cadastros para quem NÓS já vendemos/enviamos este produto (SAIDA concluída; ignora estorno/devolução)",
    },
    fornecedores: rel.fornecedores,
    clientes: rel.clientes,
  };
}
