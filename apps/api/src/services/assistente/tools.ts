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
import {
  exportarSaldosExcel,
  exportarSaldosPdf,
} from "../saldosExportService";
import {
  exportarProdutosExcel,
  exportarProdutosPdf,
} from "../produtosExportService";
import {
  exportarArvoreExcel,
  exportarArvorePdf,
} from "../arvoreExportService";
import {
  janelaHojeSaoPaulo,
  janelaMesSaoPaulo,
} from "./systemPrompt";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ToolContext = {
  user: AuthUser;
  /** Hint do filtro do dashboard (opcional) */
  filialHint?: string | null;
  /** Overrides de ACL do usuário (já resolvidos ou raw do banco) */
  permissoes?: PermissoesUsuario | Partial<Record<string, boolean>> | null;
};

/**
 * Papel do parceiro na movimentação (não o rótulo do cadastro).
 * Compra/ENTRADA → fornecedor; Venda/SAIDA → cliente; transferência → null.
 */
function papelParceiroNaMovimentacao(opts: {
  operacao: string;
  tipoNome: string;
  temParceiro: boolean;
  temDestinoEstoque?: boolean;
}): "fornecedor" | "cliente" | null {
  if (!opts.temParceiro) return null;
  if (opts.temDestinoEstoque || /transfer/i.test(opts.tipoNome)) return null;
  if (opts.operacao === "ENTRADA") return "fornecedor";
  if (opts.operacao === "SAIDA") return "cliente";
  return null;
}

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

/** Produtos pai com BOM (árvore de componentes, 1 nível). */
const listProductTreesArgs = z.object({
  q: z.string().min(1).max(80).optional().nullable(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(30),
  /** true = inclui filhos (qtd, fantasma, preço) de cada pai */
  incluirComponentes: z.boolean().optional().default(false),
});

const getProductTreeArgs = z.object({
  codigoOuNome: z.string().min(1).max(120),
});

const getProductStockArgs = z.object({
  codigoOuNome: z.string().min(1).max(120),
  filialId: z.string().uuid().optional().nullable(),
});

const listProductSeriesArgs = z.object({
  codigoOuNome: z.string().min(1).max(120),
  filialId: z.string().uuid().optional().nullable(),
  filialSigla: z.string().min(1).max(80).optional().nullable(),
  /** EM_ESTOQUE = disponíveis (padrão); TODOS = qualquer status */
  status: z
    .enum(["EM_ESTOQUE", "EM_TRANSITO", "SAIDO", "TODOS"])
    .optional()
    .default("EM_ESTOQUE"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
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
  /** Filtra pela operação gravada na movimentação (badge da tela). */
  operacao: z
    .enum(["SAIDA", "ENTRADA", "TRANSFERENCIA"])
    .optional()
    .nullable(),
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
   * true = só saídas CONCLUIDAS ainda abertas (qty não totalmente retornada).
   * APENAS para demo/comodato ainda fora — NÃO use para “saídas do mês”.
   */
  somenteAbertos: z.boolean().optional().default(false),
});

const rankMovementsArgs = z.object({
  /**
   * Preferir periodo (datas calculadas no servidor) em vez de de/ate manuais.
   */
  periodo: z
    .enum(["mes_atual", "mes_passado", "hoje", "custom"])
    .optional()
    .default("mes_atual"),
  de: z.string().min(4).max(40).optional().nullable(),
  ate: z.string().min(4).max(40).optional().nullable(),
  /**
   * saida = badge SAÍDA (venda/entrega…; sem transferência nem tipo sistema)
   * entrada = badge ENT. (compra…; sem transferência recebida)
   * transferencia = só Transferência Enviada (conta 1× por envio)
   * qualquer = tudo no período
   */
  sentido: z
    .enum(["saida", "entrada", "transferencia", "qualquer"])
    .optional()
    .default("saida"),
  filialId: z.string().uuid().optional().nullable(),
  filialSigla: z.string().min(1).max(80).optional().nullable(),
  limit: z.coerce.number().int().min(1).max(30).optional().default(10),
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

const exportProdutosReportArgs = z.object({
  format: z.enum(["pdf", "xlsx"]),
  q: z.string().min(1).max(80).optional().nullable(),
  categoriaId: z.string().uuid().optional().nullable(),
  ativo: z.boolean().optional().nullable(),
});

const exportSaldosReportArgs = z.object({
  format: z.enum(["pdf", "xlsx"]),
  filialId: z.string().uuid().optional().nullable(),
  q: z.string().min(1).max(80).optional().nullable(),
  categoriaId: z.string().uuid().optional().nullable(),
  alerta: z.enum(["min", "max", "qualquer"]).optional().nullable(),
});

const exportArvoreReportArgs = z.object({
  format: z.enum(["pdf", "xlsx"]),
  q: z.string().min(1).max(80).optional().nullable(),
  codigoOuNome: z.string().min(1).max(120).optional().nullable(),
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
    name: "list_product_trees",
    description:
      "Lista produtos PAI que possuem árvore de componentes (BOM, 1 nível). Use para 'quais itens têm árvore', 'produtos com BOM', 'árvore de produto'. Opcionalmente inclui os componentes (quantidade, fantasma, preço).",
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Filtro opcional por código/descrição do produto pai",
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        incluirComponentes: {
          type: "boolean",
          description:
            "true = retorna também os filhos de cada árvore (qtd, fantasma, preço)",
        },
      },
    },
  },
  {
    name: "get_product_tree",
    description:
      "Detalha a árvore (BOM) de UM produto pai: componentes, quantidade, fantasma e preços. Use para 'componentes do SKU X', 'árvore do produto Y'. Se o produto não tiver árvore, retorna temArvore=false.",
    parameters: {
      type: "object",
      properties: {
        codigoOuNome: {
          type: "string",
          description: "Código ou nome do produto pai",
        },
      },
      required: ["codigoOuNome"],
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
      "Saldos e valor (saldo×preço) de um produto por filial. Se o produto existe mas não tem posição, retorna saldo 0. NÃO lista números de série — para N/S use list_product_series.",
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
    name: "list_product_series",
    description:
      "Lista números de série (N/S) de um produto. USE para 'quais séries', 'números de série', 'N/S em estoque', follow-up 'quais são os números?' após um saldo. Padrão: só EM_ESTOQUE. Agrupa por filial. Filial citada → filialSigla.",
    parameters: {
      type: "object",
      properties: {
        codigoOuNome: {
          type: "string",
          description: "Código ou nome/descrição do produto (ex.: LG4S4, GSL64S4)",
        },
        filialId: {
          type: "string",
          description: "UUID da filial (opcional)",
        },
        filialSigla: {
          type: "string",
          description: "Sigla/nome da filial (ex.: PLN, RMA). Preferir em vez de UUID.",
        },
        status: {
          type: "string",
          enum: ["EM_ESTOQUE", "EM_TRANSITO", "SAIDO", "TODOS"],
          description: "Padrão EM_ESTOQUE (disponíveis no estoque)",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Máx. de séries retornadas (padrão 100)",
        },
      },
      required: ["codigoOuNome"],
    },
  },
  {
    name: "list_stock_movements",
    description:
      "Lista movimentações (máx. 50). NÃO use para 'produto com mais saída no mês' — use rank_product_movements. CONSULTAR transferência: fluxo=transferencia. operacao=SAIDA filtra o campo operacao do ledger (inclui Transferência Enviada; NÃO é o badge SAÍDA da tela). NÃO use somenteAbertos para saídas do mês. Datas: ISO ou YYYY-MM-DD — nunca dd/mm/aaaa.",
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
            "ISO ou YYYY-MM-DD (início). Nunca dd/mm/aaaa. Prefira janelas do system prompt.",
        },
        ate: {
          type: "string",
          description: "ISO ou YYYY-MM-DD (fim). Nunca dd/mm/aaaa.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        operacao: {
          type: "string",
          enum: ["SAIDA", "ENTRADA", "TRANSFERENCIA"],
          description:
            "Campo operacao no ledger. SAIDA inclui Venda/Entrega E Transferência Enviada. Para ranking de badge SAÍDA da tela use rank_product_movements.",
        },
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
            "true = só demo/comodato ainda fora (falta retornar). NÃO use para 'saídas do mês'.",
        },
      },
    },
  },
  {
    name: "rank_product_movements",
    description:
      "Ranking de produtos por quantidade no período. USE para 'qual produto teve mais saída esse mês/mês passado/hoje'. periodo=mes_atual|mes_passado|hoje (datas no servidor). sentido=saida = badge SAÍDA (exclui transferência e tipo sistema). Se empateNoTopo=true, cite os empatados — não invente um único campeão.",
    parameters: {
      type: "object",
      properties: {
        periodo: {
          type: "string",
          enum: ["mes_atual", "mes_passado", "hoje", "custom"],
          description: "Preferir mes_atual / mes_passado / hoje",
        },
        de: {
          type: "string",
          description: "Só se periodo=custom — ISO ou YYYY-MM-DD",
        },
        ate: {
          type: "string",
          description: "Só se periodo=custom — ISO ou YYYY-MM-DD",
        },
        sentido: {
          type: "string",
          enum: ["saida", "entrada", "transferencia", "qualquer"],
          description:
            "saida (padrão) = vendas/entregas; transferencia = só enviadas; entrada = compras etc.",
        },
        filialId: { type: "string" },
        filialSigla: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 30 },
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
    name: "export_produtos_report",
    description:
      "Gera relatório PDF/Excel do CADÁSTRO de produtos (lista com preços). Use para 'relatório de produtos', 'exportar lista de produtos'. Exige permissão Relatórios. Também pode sugerir actionLink /relatorios?aba=produtos.",
    parameters: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["pdf", "xlsx"] },
        q: { type: "string", description: "Filtro opcional código/descrição" },
        categoriaId: { type: "string" },
        ativo: {
          type: "boolean",
          description: "true = só ativos; false = só inativos; omitir = todos",
        },
      },
      required: ["format"],
    },
  },
  {
    name: "export_saldos_report",
    description:
      "Gera relatório PDF/Excel de ESTOQUE/saldos. Use para 'relatório de estoque', 'abaixo do mínimo', 'acima do máximo'. alerta=min|max|qualquer. Exige permissão Relatórios.",
    parameters: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["pdf", "xlsx"] },
        filialId: { type: "string" },
        q: { type: "string" },
        categoriaId: { type: "string" },
        alerta: {
          type: "string",
          enum: ["min", "max", "qualquer"],
          description:
            "min = abaixo do mínimo; max = acima do máximo; qualquer = fora da faixa",
        },
      },
      required: ["format"],
    },
  },
  {
    name: "export_arvore_report",
    description:
      "Gera relatório PDF/Excel da ÁRVORE de produto (BOM). Use para 'relatório da árvore', 'exportar BOM'. codigoOuNome filtra um pai; omitir = todas as árvores. Exige permissão Relatórios.",
    parameters: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["pdf", "xlsx"] },
        q: { type: "string", description: "Filtro por código/descrição do pai" },
        codigoOuNome: {
          type: "string",
          description: "Produto pai específico (código ou nome)",
        },
      },
      required: ["format"],
    },
  },
  {
    name: "prepare_transfer",
    description:
      "Só para CRIAR intenção de transferência (usuário quer transferir agora). NÃO use para consultar histórico (‘teve transferência?’). quantidade = número EXATO pedido pelo usuário (se pediu 20, passe 20 — nunca o saldo). Prepara atalho Novo Lançamento. NÃO diga Transferências para criar. Retorna actionLink + saldo. Usuário ainda confirma.",
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
    case "list_product_trees":
      return listProductTrees(listProductTreesArgs.parse(rawArgs));
    case "get_product_tree":
      return getProductTree(getProductTreeArgs.parse(rawArgs));
    case "search_products":
      return searchProducts(searchProductsArgs.parse(rawArgs));
    case "get_product_stock":
      return getProductStock(getProductStockArgs.parse(rawArgs), ctx);
    case "list_product_series":
      return listProductSeries(listProductSeriesArgs.parse(rawArgs), ctx);
    case "list_stock_movements":
      return listStockMovements(listMovementsArgs.parse(rawArgs), ctx);
    case "rank_product_movements":
      return rankProductMovements(rankMovementsArgs.parse(rawArgs), ctx);
    case "get_inventory_balance":
      return getInventoryBalance(balanceArgs.parse(rawArgs), ctx);
    case "get_partner_products":
      return getPartnerProducts(partnerProductsArgs.parse(rawArgs));
    case "get_product_partners":
      return getProductPartners(productPartnersArgs.parse(rawArgs));
    case "export_product_report":
      return exportProductReport(exportProductReportArgs.parse(rawArgs), ctx);
    case "export_produtos_report":
      return exportProdutosReport(exportProdutosReportArgs.parse(rawArgs), ctx);
    case "export_saldos_report":
      return exportSaldosReport(exportSaldosReportArgs.parse(rawArgs), ctx);
    case "export_arvore_report":
      return exportArvoreReport(exportArvoreReportArgs.parse(rawArgs), ctx);
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
      "Atalho pronto. Avise o usuário para clicar no botão abaixo — a tela Novo Lançamento abre com a transferência preenchida. Ele ainda precisa confirmar o lançamento. Transferências é só para acompanhar/conferir o que já saiu.",
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

function assertPermRelatorios(ctx: ToolContext) {
  const perms = resolvePermissoes(ctx.user.perfil, ctx.permissoes ?? null);
  if (!hasPermissao(ctx.user.perfil, perms, "relatorios")) {
    return {
      ok: false as const,
      error:
        "Usuário sem permissão de Relatórios. Oriente pedir acesso ao Admin ou abrir a tela se tiver acesso.",
    };
  }
  return null;
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

async function exportProdutosReport(
  args: z.infer<typeof exportProdutosReportArgs>,
  ctx: ToolContext
) {
  const denied = assertPermRelatorios(ctx);
  if (denied) return denied;
  try {
    const fn =
      args.format === "pdf" ? exportarProdutosPdf : exportarProdutosExcel;
    const { buffer, filename } = await fn(ctx.user, {
      q: args.q,
      categoriaId: args.categoriaId,
      // Alinha com a tela Relatórios (default: só ativos)
      ativo: args.ativo === undefined || args.ativo === null ? true : args.ativo,
    });
    const label = `Relatório de produtos (${args.format.toUpperCase()})`;
    const downloadToken = putAssistenteExport({
      userId: ctx.user.id,
      buffer,
      filename,
      format: args.format,
      label,
    });
    const qs = new URLSearchParams({ aba: "produtos" });
    if (args.q?.trim()) qs.set("q", args.q.trim());
    const ativoExport =
      args.ativo === undefined || args.ativo === null ? true : args.ativo;
    qs.set("ativo", ativoExport ? "true" : "false");
    if (args.categoriaId) qs.set("categoriaId", args.categoriaId);
    return {
      ok: true,
      format: args.format,
      filename,
      downloadToken,
      label,
      actionLink: {
        href: `/relatorios?${qs.toString()}`,
        label: "Abrir Relatórios · Produtos",
      },
      mensagem:
        "Arquivo gerado. Use o botão de download abaixo; também há atalho para a tela Relatórios.",
    };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha ao gerar relatório",
    };
  }
}

async function exportSaldosReport(
  args: z.infer<typeof exportSaldosReportArgs>,
  ctx: ToolContext
) {
  const denied = assertPermRelatorios(ctx);
  if (denied) return denied;
  try {
    const filialId = resolveFilialId(
      ctx.user,
      args.filialId,
      ctx.filialHint
    );
    const fn = args.format === "pdf" ? exportarSaldosPdf : exportarSaldosExcel;
    const { buffer, filename } = await fn(ctx.user, {
      filialId,
      q: args.q,
      categoriaId: args.categoriaId,
      alerta: args.alerta ?? null,
    });
    const label = `Relatório de estoque/saldos (${args.format.toUpperCase()})`;
    const downloadToken = putAssistenteExport({
      userId: ctx.user.id,
      buffer,
      filename,
      format: args.format,
      label,
    });
    const qs = new URLSearchParams({ aba: "saldos" });
    if (args.alerta) qs.set("alerta", args.alerta);
    if (args.q?.trim()) qs.set("q", args.q.trim());
    if (filialId) qs.set("filialId", filialId);
    return {
      ok: true,
      format: args.format,
      filename,
      downloadToken,
      label,
      actionLink: {
        href: `/relatorios?${qs.toString()}`,
        label: "Abrir Relatórios · Estoque",
      },
      mensagem:
        "Arquivo gerado. Use o botão de download abaixo; também há atalho para a tela Relatórios.",
    };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha ao gerar relatório",
    };
  }
}

async function exportArvoreReport(
  args: z.infer<typeof exportArvoreReportArgs>,
  ctx: ToolContext
) {
  const denied = assertPermRelatorios(ctx);
  if (denied) return denied;
  try {
    let produtoPaiId: string | undefined;
    const codigoOuNome = args.codigoOuNome?.trim();
    if (codigoOuNome) {
      const p = await findProdutoByCodigoOuNome(codigoOuNome);
      if (!p) {
        return {
          ok: false,
          error: `Produto não encontrado para "${codigoOuNome}"`,
        };
      }
      produtoPaiId = p.id;
    }
    const fn = args.format === "pdf" ? exportarArvorePdf : exportarArvoreExcel;
    const { buffer, filename } = await fn(ctx.user, {
      q: produtoPaiId ? null : args.q,
      produtoPaiId,
    });
    const label = `Relatório de árvore de produto (${args.format.toUpperCase()})`;
    const downloadToken = putAssistenteExport({
      userId: ctx.user.id,
      buffer,
      filename,
      format: args.format,
      label,
    });
    const qs = new URLSearchParams({ aba: "arvores" });
    if (produtoPaiId) {
      qs.set("produtoPaiId", produtoPaiId);
      if (codigoOuNome) qs.set("q", codigoOuNome);
    } else if (args.q?.trim()) {
      qs.set("q", args.q.trim());
    }
    return {
      ok: true,
      format: args.format,
      filename,
      downloadToken,
      label,
      actionLink: {
        href: `/relatorios?${qs.toString()}`,
        label: "Abrir Relatórios · Árvore",
      },
      mensagem:
        "Arquivo gerado. Use o botão de download abaixo; também há atalho para a tela Relatórios.",
    };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha ao gerar relatório",
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
        /** Nome do cadastro (pode começar com “Cliente…” mesmo em compra). */
        parceiroNome: string | null;
        parceiroTipoCadastro: string | null;
        /** Papel nesta movimentação: compra→fornecedor, venda→cliente. */
        papelParceiro: "fornecedor" | "cliente" | null;
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
            cliente: { select: { nome: true, tipo: true } },
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
                parceiroNome: m.cliente?.nome ?? null,
                parceiroTipoCadastro: m.cliente?.tipo ?? null,
                papelParceiro: papelParceiroNaMovimentacao({
                  operacao: m.tipo.operacao,
                  tipoNome: m.tipo.nome,
                  temParceiro: Boolean(m.cliente),
                  temDestinoEstoque: Boolean(m.filialDestino),
                }),
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

async function listProductTrees(args: z.infer<typeof listProductTreesArgs>) {
  const q = args.q?.trim() || "";
  const where = {
    ativo: true,
    componentesComoPai: { some: {} },
    ...(q
      ? {
          OR: [
            { codigo: { contains: q, mode: "insensitive" as const } },
            { descricao: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  if (!args.incluirComponentes) {
    const rows = await prisma.produto.findMany({
      where,
      select: {
        codigo: true,
        descricao: true,
        precoUnitario: true,
        _count: { select: { componentesComoPai: true } },
      },
      orderBy: { codigo: "asc" },
      take: args.limit,
    });
    return {
      encontrados: rows.length,
      produtos: rows.map((p) => ({
        codigo: p.codigo,
        descricao: p.descricao,
        precoUnitario: Number(p.precoUnitario),
        qtdComponentes: p._count.componentesComoPai,
      })),
    };
  }

  const rows = await prisma.produto.findMany({
    where,
    select: {
      codigo: true,
      descricao: true,
      precoUnitario: true,
      _count: { select: { componentesComoPai: true } },
      componentesComoPai: {
        select: {
          quantidade: true,
          fantasma: true,
          produtoFilho: {
            select: {
              codigo: true,
              descricao: true,
              precoUnitario: true,
              ativo: true,
            },
          },
        },
        orderBy: { produtoFilho: { codigo: "asc" } },
      },
    },
    orderBy: { codigo: "asc" },
    take: args.limit,
  });

  return {
    encontrados: rows.length,
    produtos: rows.map((p) => ({
      codigo: p.codigo,
      descricao: p.descricao,
      precoUnitario: Number(p.precoUnitario),
      qtdComponentes: p._count.componentesComoPai,
      componentes: p.componentesComoPai.map((c) => ({
        codigo: c.produtoFilho.codigo,
        descricao: c.produtoFilho.descricao,
        quantidade: Number(c.quantidade),
        fantasma: c.fantasma,
        precoUnitario: Number(c.produtoFilho.precoUnitario),
        ativo: c.produtoFilho.ativo,
      })),
    })),
  };
}

async function getProductTree(args: z.infer<typeof getProductTreeArgs>) {
  const produto = await findProdutoByCodigoOuNome(args.codigoOuNome);
  if (!produto) {
    return {
      encontrado: false,
      mensagem: `Produto não encontrado para "${args.codigoOuNome.trim()}"`,
    };
  }

  const itens = await prisma.produtoComponente.findMany({
    where: { produtoPaiId: produto.id },
    select: {
      quantidade: true,
      fantasma: true,
      produtoFilho: {
        select: {
          codigo: true,
          descricao: true,
          precoUnitario: true,
          ativo: true,
        },
      },
    },
    orderBy: { produtoFilho: { codigo: "asc" } },
  });

  return {
    encontrado: true,
    temArvore: itens.length > 0,
    produto: {
      codigo: produto.codigo,
      descricao: produto.descricao,
      precoUnitario: Number(produto.precoUnitario),
    },
    qtdComponentes: itens.length,
    componentes: itens.map((c) => ({
      codigo: c.produtoFilho.codigo,
      descricao: c.produtoFilho.descricao,
      quantidade: Number(c.quantidade),
      fantasma: c.fantasma,
      precoUnitario: Number(c.produtoFilho.precoUnitario),
      ativo: c.produtoFilho.ativo,
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
    controlaSerie: true,
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
      controlaSerie: produto.controlaSerie === true,
    },
    saldos,
    qtyTotal,
    valorTotal,
    mensagem:
      saldos.length === 0 || qtyTotal === 0
        ? "Produto cadastrado, mas sem saldo em estoque (qty 0)."
        : produto.controlaSerie
          ? "Para listar os números de série, use list_product_series."
          : undefined,
  };
}

async function listProductSeries(
  args: z.infer<typeof listProductSeriesArgs>,
  ctx: ToolContext
) {
  let filialId = resolveFilialId(ctx.user, args.filialId, ctx.filialHint);
  let filialResolvida: { id: string; sigla: string; nome: string } | null =
    null;

  if (args.filialSigla?.trim()) {
    const f = await findFilialBySiglaOuNome(args.filialSigla);
    if (!f) {
      return {
        encontrado: false,
        mensagem: `Filial não encontrada: “${args.filialSigla.trim()}”`,
      };
    }
    if (ctx.user.perfil === "OPERADOR") {
      const ids =
        ctx.user.filialIds?.length > 0
          ? ctx.user.filialIds
          : ctx.user.filialId
            ? [ctx.user.filialId]
            : [];
      if (!ids.includes(f.id)) {
        return {
          encontrado: false,
          mensagem: "Sem acesso a esta filial",
        };
      }
    }
    filialId = f.id;
    filialResolvida = f;
  }

  if (filialId) await assertFilialAtiva(filialId);

  const produto = await findProdutoByCodigoOuNome(args.codigoOuNome);
  if (!produto) {
    return { encontrado: false, mensagem: "Produto não encontrado no cadastro" };
  }

  if (!produto.controlaSerie) {
    return {
      encontrado: true,
      produto: {
        codigo: produto.codigo,
        descricao: produto.descricao,
        controlaSerie: false,
      },
      total: 0,
      porFilial: [],
      mensagem:
        "Este produto não controla número de série — só há saldo quantitativo.",
    };
  }

  const statusFilter =
    args.status === "TODOS"
      ? undefined
      : (args.status as "EM_ESTOQUE" | "EM_TRANSITO" | "SAIDO");

  const whereFilial =
    filialId
      ? { filialId }
      : ctx.user.perfil === "OPERADOR"
        ? {
            filialId: {
              in:
                ctx.user.filialIds?.length > 0
                  ? ctx.user.filialIds
                  : ctx.user.filialId
                    ? [ctx.user.filialId]
                    : [],
            },
          }
        : {};

  const rows = await prisma.unidadeSerie.findMany({
    where: {
      produtoId: produto.id,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...whereFilial,
    },
    select: {
      numeroSerie: true,
      status: true,
      filial: { select: { sigla: true, nome: true } },
    },
    orderBy: [{ filial: { sigla: "asc" } }, { numeroSerie: "asc" }],
    take: args.limit + 1,
  });

  const truncated = rows.length > args.limit;
  const slice = truncated ? rows.slice(0, args.limit) : rows;

  const bySigla = new Map<
    string,
    {
      filialSigla: string;
      filialNome: string;
      qty: number;
      series: string[];
      statusCounts: Record<string, number>;
    }
  >();

  for (const r of slice) {
    const sigla = r.filial?.sigla || "—";
    let bucket = bySigla.get(sigla);
    if (!bucket) {
      bucket = {
        filialSigla: sigla,
        filialNome: r.filial?.nome || sigla,
        qty: 0,
        series: [],
        statusCounts: {},
      };
      bySigla.set(sigla, bucket);
    }
    bucket.qty += 1;
    bucket.series.push(r.numeroSerie);
    bucket.statusCounts[r.status] = (bucket.statusCounts[r.status] || 0) + 1;
  }

  const porFilial = [...bySigla.values()];
  const total = slice.length;

  return {
    encontrado: true,
    asOf: new Date().toISOString(),
    produto: {
      codigo: produto.codigo,
      descricao: produto.descricao,
      controlaSerie: true,
    },
    filtro: {
      status: args.status,
      filialSigla: filialResolvida?.sigla || null,
      filialId: filialId || null,
    },
    total,
    truncated,
    porFilial,
    mensagem:
      total === 0
        ? args.status === "EM_ESTOQUE"
          ? "Nenhuma série EM_ESTOQUE para este produto nos estoques consultados."
          : "Nenhuma série encontrada com os filtros."
        : truncated
          ? `Mostrando as primeiras ${total} séries (há mais). Peça uma filial (ex.: PLN) ou aumente o limit.`
          : undefined,
  };
}

/**
 * Parse de datas do assistente.
 * Aceita ISO completo ou YYYY-MM-DD (dia civil SP).
 * Rejeita dd/mm/aaaa (JS interpreta como MM/DD e quebra o mês).
 */
export function parseAssistenteDateBound(
  raw: string,
  bound: "start" | "end"
): { ok: true; date: Date } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) return { ok: false, error: "Data vazia" };

  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    return {
      ok: false,
      error: `Data “${s}” parece dd/mm/aaaa — use periodo=mes_atual|mes_passado|hoje ou ISO/YYYY-MM-DD (nunca dd/mm).`,
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const iso =
      bound === "start"
        ? `${s}T00:00:00-03:00`
        : `${s}T23:59:59.999-03:00`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: `Data inválida: ${s}` };
    }
    return { ok: true, date };
  }

  const date = new Date(s);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: `Data inválida: ${s}` };
  }
  return { ok: true, date };
}

function resolvePeriodoJanela(
  periodo: "mes_atual" | "mes_passado" | "hoje" | "custom",
  deRaw?: string | null,
  ateRaw?: string | null
):
  | { ok: true; de: Date; ate: Date; label: string; periodo: string }
  | { ok: false; error: string } {
  if (periodo === "hoje") {
    const j = janelaHojeSaoPaulo();
    return {
      ok: true,
      de: new Date(j.deIso),
      ate: new Date(j.ateIso),
      label: `hoje ${j.dataCivil}`,
      periodo,
    };
  }
  if (periodo === "mes_atual") {
    const j = janelaMesSaoPaulo(0);
    return {
      ok: true,
      de: new Date(j.deIso),
      ate: new Date(j.ateIso),
      label: `mês ${j.label}`,
      periodo,
    };
  }
  if (periodo === "mes_passado") {
    const j = janelaMesSaoPaulo(-1);
    return {
      ok: true,
      de: new Date(j.deIso),
      ate: new Date(j.ateIso),
      label: `mês ${j.label}`,
      periodo,
    };
  }

  if (!deRaw?.trim() || !ateRaw?.trim()) {
    return {
      ok: false,
      error: "periodo=custom exige de e ate (ISO ou YYYY-MM-DD)",
    };
  }
  const deP = parseAssistenteDateBound(deRaw, "start");
  if (!deP.ok) return deP;
  const ateP = parseAssistenteDateBound(ateRaw, "end");
  if (!ateP.ok) return ateP;
  if (deP.date > ateP.date) {
    return { ok: false, error: "de deve ser ≤ ate" };
  }
  return {
    ok: true,
    de: deP.date,
    ate: ateP.date,
    label: "custom",
    periodo,
  };
}

async function rankProductMovements(
  args: z.infer<typeof rankMovementsArgs>,
  ctx: ToolContext
) {
  const janela = resolvePeriodoJanela(
    args.periodo || "mes_atual",
    args.de,
    args.ate
  );
  if (!janela.ok) {
    return { ok: false, encontrados: 0, ranking: [], error: janela.error };
  }

  const sentido = args.sentido || "saida";
  const limit = args.limit || 10;

  const opIds =
    ctx.user.perfil === "OPERADOR"
      ? ctx.user.filialIds?.length > 0
        ? ctx.user.filialIds
        : ctx.user.filialId
          ? [ctx.user.filialId]
          : []
      : null;

  let filialId: string | null = null;
  if (args.filialSigla?.trim()) {
    const bySigla = await findFilialBySiglaOuNome(args.filialSigla);
    if (!bySigla) {
      return {
        ok: false,
        encontrados: 0,
        ranking: [],
        error: `Estoque não encontrado: “${args.filialSigla}”`,
      };
    }
    if (opIds && !opIds.includes(bySigla.id)) {
      return {
        ok: false,
        encontrados: 0,
        ranking: [],
        error: "Operador sem acesso a este estoque",
      };
    }
    filialId = bySigla.id;
  } else if (args.filialId) {
    filialId = resolveFilialId(ctx.user, args.filialId, null);
  } else {
    // Ranking de período: não herdar filtro frágil do dashboard (Admin/Gerente vê tudo)
    filialId =
      ctx.user.perfil === "OPERADOR"
        ? resolveFilialId(ctx.user, null, ctx.filialHint)
        : null;
  }
  if (filialId) await assertFilialAtiva(filialId);

  const where: Record<string, unknown> = {
    status: "CONCLUIDO",
    estornoDeId: null,
    dataMovimento: { gte: janela.de, lte: janela.ate },
  };

  if (filialId) {
    where.OR = [{ filialId }, { filialDestinoId: filialId }];
  } else if (opIds?.length) {
    where.OR = [
      { filialId: { in: opIds } },
      { filialDestinoId: { in: opIds } },
    ];
  }

  if (sentido === "saida") {
    // Badge SAÍDA na tela: operacao SAIDA sem destino (não é Transferência Enviada)
    // e sem tipos de sistema (baixa de componente da árvore).
    where.operacao = "SAIDA";
    where.filialDestinoId = null;
    where.tipo = { sistema: false };
  } else if (sentido === "entrada") {
    where.operacao = "ENTRADA";
    where.tipo = {
      sistema: false,
      NOT: { nome: { contains: "transfer", mode: "insensitive" } },
    };
  } else if (sentido === "transferencia") {
    where.operacao = "SAIDA";
    where.filialDestinoId = { not: null };
    where.tipo = { nome: { contains: "transfer", mode: "insensitive" } };
  }

  const grouped = await prisma.movimentacao.groupBy({
    by: ["produtoId"],
    where,
    _sum: { quantidade: true },
    _count: { _all: true },
    orderBy: { _sum: { quantidade: "desc" } },
    take: limit,
  });

  if (grouped.length === 0) {
    return {
      ok: true,
      encontrados: 0,
      periodo: janela.periodo,
      periodoLabel: janela.label,
      de: janela.de.toISOString(),
      ate: janela.ate.toISOString(),
      sentido,
      ranking: [],
      mensagem:
        sentido === "saida"
          ? `Nenhuma saída (venda/entrega) em ${janela.label}.`
          : sentido === "entrada"
            ? `Nenhuma entrada (compra etc.) em ${janela.label}.`
            : sentido === "transferencia"
              ? `Nenhuma transferência enviada em ${janela.label}.`
              : `Nenhuma movimentação em ${janela.label}.`,
    };
  }

  const produtoIds = grouped.map((g) => g.produtoId);
  const produtos = await prisma.produto.findMany({
    where: { id: { in: produtoIds } },
    select: { id: true, codigo: true, descricao: true, unidade: true },
  });
  const byId = new Map(produtos.map((p) => [p.id, p]));

  // Detalhe leve: tipos e parceiros mais frequentes por produto (amostra)
  const amostra = await prisma.movimentacao.findMany({
    where: { ...where, produtoId: { in: produtoIds } },
    select: {
      produtoId: true,
      quantidade: true,
      tipo: { select: { nome: true } },
      cliente: { select: { nome: true } },
      filial: { select: { sigla: true } },
      filialDestino: { select: { sigla: true } },
    },
    orderBy: { dataMovimento: "desc" },
    take: Math.min(200, limit * 20),
  });

  const meta = new Map<
    string,
    { tipos: Map<string, number>; clientes: Map<string, number> }
  >();
  for (const m of amostra) {
    let slot = meta.get(m.produtoId);
    if (!slot) {
      slot = { tipos: new Map(), clientes: new Map() };
      meta.set(m.produtoId, slot);
    }
    slot.tipos.set(
      m.tipo.nome,
      (slot.tipos.get(m.tipo.nome) || 0) + Number(m.quantidade)
    );
    if (m.cliente?.nome) {
      slot.clientes.set(
        m.cliente.nome,
        (slot.clientes.get(m.cliente.nome) || 0) + Number(m.quantidade)
      );
    }
  }

  const rankingBase = grouped.map((g) => {
    const p = byId.get(g.produtoId);
    const m = meta.get(g.produtoId);
    const tipos = m
      ? [...m.tipos.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([nome, qty]) => ({ nome, qty }))
      : [];
    const parceiros = m
      ? [...m.clientes.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([nome, qty]) => ({ nome, qty }))
      : [];
    return {
      codigo: p?.codigo || "?",
      descricao: p?.descricao || "",
      unidade: p?.unidade || null,
      qtyTotal: Number(g._sum.quantidade || 0),
      lancamentos: g._count._all,
      tiposPrincipais: tipos,
      parceirosPrincipais: parceiros,
    };
  });

  const qtyTopo = rankingBase[0]?.qtyTotal;
  const empateNoTopo =
    qtyTopo != null &&
    rankingBase.filter((r) => r.qtyTotal === qtyTopo).length > 1;

  let colocacao = 0;
  let qtyAnterior: number | null = null;
  const ranking = rankingBase.map((r) => {
    if (qtyAnterior === null || r.qtyTotal !== qtyAnterior) {
      colocacao += 1;
      qtyAnterior = r.qtyTotal;
    }
    return {
      ...r,
      posicao: colocacao,
      empatadoNoTopo: empateNoTopo && r.qtyTotal === qtyTopo,
    };
  });

  const empatadosNoTopo = ranking.filter((r) => r.empatadoNoTopo);

  return {
    ok: true,
    encontrados: ranking.length,
    periodo: janela.periodo,
    periodoLabel: janela.label,
    de: janela.de.toISOString(),
    ate: janela.ate.toISOString(),
    sentido,
    sentidoExplicacao:
      sentido === "saida"
        ? "Badge SAÍDA (Venda/Entrega etc.), sem transferência entre estoques e sem baixa automática de componente"
        : undefined,
    ranking,
    empateNoTopo,
    empatadosNoTopo: empatadosNoTopo.map((r) => ({
      codigo: r.codigo,
      descricao: r.descricao,
      qtyTotal: r.qtyTotal,
    })),
    campeao: empateNoTopo ? null : ranking[0] || null,
    avisoEmpate: empateNoTopo
      ? `${empatadosNoTopo.length} produtos empataram no topo com qty ${qtyTopo}. Cite o empate; não escolha um único campeão.`
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

  const deP = args.de ? parseAssistenteDateBound(args.de, "start") : null;
  const ateP = args.ate ? parseAssistenteDateBound(args.ate, "end") : null;
  if (deP && !deP.ok) {
    return { encontrados: 0, movimentacoes: [], error: deP.error };
  }
  if (ateP && !ateP.ok) {
    return { encontrados: 0, movimentacoes: [], error: ateP.error };
  }
  const de = deP && deP.ok ? deP.date : undefined;
  const ate = ateP && ateP.ok ? ateP.date : undefined;

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

  const operacaoFiltro =
    args.operacao && !fluxo && !somenteAbertos ? args.operacao : null;

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
      ...(operacaoFiltro ? { operacao: operacaoFiltro } : {}),
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
      cliente: { select: { nome: true, tipo: true } },
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
      /** @deprecated Use parceiroNome + papelParceiro — nome do campo legado no schema. */
      clienteNome: m.cliente?.nome ?? null,
      parceiroNome: m.cliente?.nome ?? null,
      parceiroTipoCadastro: m.cliente?.tipo ?? null,
      papelParceiro: papelParceiroNaMovimentacao({
        operacao: m.tipo.operacao,
        tipoNome: m.tipo.nome,
        temParceiro: Boolean(m.cliente),
        temDestinoEstoque: Boolean(m.filialDestino),
      }),
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
