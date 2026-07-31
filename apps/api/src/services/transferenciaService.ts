import {
  TIPO_ESTORNO,
  TIPO_TRANSF_ENVIADA,
  TIPO_TRANSF_RECEBIDA,
  TIPO_TRANSF_ENTRE_ESTOQUES,
} from "@teep/shared";
import { prisma } from "../lib/prisma";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import {
  alertasUiDeLimiares,
  notificarDivergenciaTransferencia,
  notificarLimiaresEstoque,
  type AlertaUi,
} from "./alertaService";
import { aplicarSaldo, obterSaldo } from "./estoqueService";
import {
  assertOperadorPodeFilial,
  operadorFilialIds,
  resolveOperadorFilialId,
} from "../lib/filialScope";
import {
  aplicarSeriesConferencia,
  aplicarSeriesTransferenciaEnvio,
  efetivarSeriesTransferenciaAposAprovacao,
  normalizarSeries,
  reservarSeriesTransferenciaPendente,
  SERIE_STATUS,
} from "./serieService";

const LIST_LIMITE = 200;

const transfInclude = {
  origemFilial: true,
  destinoFilial: true,
  criadoPor: { select: { id: true, nome: true, email: true } },
  itens: {
    include: {
      produto: true,
      series: {
        include: {
          unidadeSerie: {
            select: {
              id: true,
              numeroSerie: true,
              status: true,
              filialId: true,
            },
          },
        },
      },
      movimentacoes: {
        include: { tipo: true },
        orderBy: { dataMovimento: "asc" as const },
      },
    },
  },
} as const;

/** Compara quantidades com 4 casas (mesmo scale do Decimal do estoque) */
function qtdIguais(a: number, b: number): boolean {
  return Math.round(a * 10000) === Math.round(b * 10000);
}

function assertFilialOperadorOrigem(user: AuthUser, origemFilialId: string) {
  if (user.perfil === "OPERADOR") {
    assertOperadorPodeFilial(user, origemFilialId);
  }
}

function assertFilialOperadorDestino(user: AuthUser, destinoFilialId: string) {
  if (user.perfil === "OPERADOR") {
    assertOperadorPodeFilial(user, destinoFilialId);
  }
}

async function tiposSistema() {
  const [enviada, recebida, estorno] = await Promise.all([
    prisma.tipoMovimentacao.findUnique({ where: { nome: TIPO_TRANSF_ENVIADA } }),
    prisma.tipoMovimentacao.findUnique({
      where: { nome: TIPO_TRANSF_RECEBIDA },
    }),
    prisma.tipoMovimentacao.findUnique({ where: { nome: TIPO_ESTORNO } }),
  ]);
  if (!enviada || !recebida) {
    throw new AppError(
      500,
      "Tipos Transferência Enviada/Recebida não configurados"
    );
  }
  if (!estorno) throw new AppError(500, "Tipo Estorno não configurado");
  return { enviada, recebida, estorno };
}

type Tx = import("@prisma/client").Prisma.TransactionClient;

/** Qty em cargas PENDENTE_APROVACAO que “reservam” saldo da origem (sem baixar estoque ainda). */
async function qtyReservadaPendenteAprovacao(
  db: Tx | typeof prisma,
  produtoId: string,
  origemFilialId: string,
  excludeTransferenciaId?: string | null
): Promise<number> {
  const rows = await db.transferenciaItem.findMany({
    where: {
      produtoId,
      transferencia: {
        status: "PENDENTE_APROVACAO",
        origemFilialId,
        ...(excludeTransferenciaId
          ? { id: { not: excludeTransferenciaId } }
          : {}),
      },
    },
    select: { qtdEnviada: true },
  });
  return rows.reduce((s, r) => s + Number(r.qtdEnviada), 0);
}

/** Trava estoque e garante saldo livre (saldo − reservas pendentes). */
async function assertSaldoDisponivelOrigem(
  tx: Tx,
  opts: {
    produtoId: string;
    produtoCodigo: string;
    origemFilialId: string;
    origemSigla: string;
    quantidade: number;
    excludeTransferenciaId?: string | null;
  }
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM estoques
    WHERE produto_id = ${opts.produtoId}::uuid
      AND filial_id = ${opts.origemFilialId}::uuid
    FOR UPDATE
  `;
  const saldo = await obterSaldo(tx, opts.produtoId, opts.origemFilialId);
  const reservada = await qtyReservadaPendenteAprovacao(
    tx,
    opts.produtoId,
    opts.origemFilialId,
    opts.excludeTransferenciaId
  );
  const disponivel = Number(saldo) - reservada;
  if (opts.quantidade > disponivel + 1e-9) {
    throw new AppError(
      400,
      `Saldo insuficiente em ${opts.origemSigla} para ${opts.produtoCodigo} (disponível: ${disponivel}, reservado pendente: ${reservada})`
    );
  }
}

type AlertaLimiarRaw = {
  produtoId?: string;
  produtoCodigo: string;
  produtoDescricao: string;
  abaixoMinimo: boolean;
  acimaMaximo: boolean;
  saldoAtual: number;
  filialNome: string;
};

function emitirAlertasLimiaresTransferencia(
  alertasRaw: AlertaLimiarRaw[]
): AlertaUi[] {
  const alertasUi: AlertaUi[] = [];
  for (const a of alertasRaw) {
    if (!a.abaixoMinimo && !a.acimaMaximo) continue;
    notificarLimiaresEstoque({
      abaixoMinimo: a.abaixoMinimo,
      acimaMaximo: a.acimaMaximo,
      produtoCodigo: a.produtoCodigo,
      produtoDescricao: a.produtoDescricao,
      filialNome: a.filialNome,
      saldoAtual: a.saldoAtual,
    });
    alertasUi.push(
      ...alertasUiDeLimiares({
        abaixoMinimo: a.abaixoMinimo,
        acimaMaximo: a.acimaMaximo,
        produtoLabel: `${a.produtoCodigo} (${a.produtoDescricao})`,
      })
    );
  }
  return alertasUi;
}

function whereEscopo(user: AuthUser) {
  if (user.perfil !== "OPERADOR") return {};
  const ids = operadorFilialIds(user);
  return {
    OR: [
      { origemFilialId: { in: ids } },
      { destinoFilialId: { in: ids } },
    ],
  };
}

export async function listarTransferencias(user: AuthUser) {
  const where = whereEscopo(user);
  const [total, data] = await Promise.all([
    prisma.transferencia.count({ where }),
    prisma.transferencia.findMany({
      where,
      include: transfInclude,
      orderBy: { criadoEm: "desc" },
      take: LIST_LIMITE,
    }),
  ]);
  return {
    data,
    total,
    take: LIST_LIMITE,
    truncado: total > LIST_LIMITE,
  };
}

export async function obterTransferencia(user: AuthUser, id: string) {
  const t = await prisma.transferencia.findUnique({
    where: { id },
    include: transfInclude,
  });
  if (!t) throw new AppError(404, "Transferência não encontrada");
  if (user.perfil === "OPERADOR") {
    const ids = operadorFilialIds(user);
    if (
      !ids.includes(t.origemFilialId) &&
      !ids.includes(t.destinoFilialId)
    ) {
      throw new AppError(403, "Acesso negado");
    }
  }
  return t;
}

/** Envia carga: −origem por item; status EM_TRANSITO */
export async function criarTransferencia(
  user: AuthUser,
  input: {
    origemFilialId?: string;
    destinoFilialId: string;
    guiaTransporte?: string | null;
    itens: Array<{ produtoId: string; quantidade: number; series?: string[] }>;
  }
) {
  return criarTransferenciaInterna(user, input, "AGUARDAR_RECEBIMENTO", false);
}

/** Credita destino na hora: SAÍDA origem + ENTRADA destino; status RECEBIDO */
export async function criarTransferenciaImediata(
  user: AuthUser,
  input: {
    origemFilialId?: string;
    destinoFilialId: string;
    guiaTransporte?: string | null;
    itens: Array<{ produtoId: string; quantidade: number; series?: string[] }>;
  }
) {
  return criarTransferenciaInterna(user, input, "IMEDIATO", false);
}

/**
 * Operador + tipo.requerAprovacao: cria carga sem mexer saldo.
 * Gerente/Admin aprova depois (aplica efeitos).
 */
export async function criarTransferenciaPendenteAprovacao(
  user: AuthUser,
  input: {
    origemFilialId?: string;
    destinoFilialId: string;
    guiaTransporte?: string | null;
    itens: Array<{ produtoId: string; quantidade: number; series?: string[] }>;
  },
  creditoDestino: "IMEDIATO" | "AGUARDAR_RECEBIMENTO"
) {
  return criarTransferenciaInterna(user, input, creditoDestino, true);
}

async function criarTransferenciaInterna(
  user: AuthUser,
  input: {
    origemFilialId?: string;
    destinoFilialId: string;
    guiaTransporte?: string | null;
    itens: Array<{ produtoId: string; quantidade: number; series?: string[] }>;
  },
  creditoDestino: "IMEDIATO" | "AGUARDAR_RECEBIMENTO",
  pendenteAprovacao: boolean
) {
  let origemFilialId = input.origemFilialId;
  if (user.perfil === "OPERADOR") {
    origemFilialId = resolveOperadorFilialId(user, input.origemFilialId);
  }
  if (!origemFilialId) {
    throw new AppError(400, "Filial de origem obrigatória");
  }
  assertFilialOperadorOrigem(user, origemFilialId);

  if (origemFilialId === input.destinoFilialId) {
    throw new AppError(400, "Origem e destino devem ser filiais diferentes");
  }

  const [origem, destino] = await Promise.all([
    prisma.filial.findFirst({ where: { id: origemFilialId, ativo: true } }),
    prisma.filial.findFirst({
      where: { id: input.destinoFilialId, ativo: true },
    }),
  ]);
  if (!origem) throw new AppError(400, "Filial de origem inválida");
  if (!destino) throw new AppError(400, "Filial de destino inválida");

  const produtoIds = [...new Set(input.itens.map((i) => i.produtoId))];
  if (produtoIds.length !== input.itens.length) {
    throw new AppError(
      400,
      "Produto duplicado na carga — consolide as quantidades"
    );
  }

  const produtos = await prisma.produto.findMany({
    where: { id: { in: produtoIds }, ativo: true },
  });
  if (produtos.length !== produtoIds.length) {
    throw new AppError(400, "Há produto inválido ou inativo na carga");
  }
  const produtoMap = new Map(produtos.map((p) => [p.id, p]));

  const { enviada, recebida } = await tiposSistema();
  const imediato = creditoDestino === "IMEDIATO";

  const result = await prisma.$transaction(async (tx) => {
    const transf = await tx.transferencia.create({
      data: {
        origemFilialId,
        destinoFilialId: input.destinoFilialId,
        status: pendenteAprovacao
          ? "PENDENTE_APROVACAO"
          : imediato
            ? "RECEBIDO"
            : "EM_TRANSITO",
        creditoDestino,
        guiaTransporte: input.guiaTransporte || null,
        criadoPorId: user.id,
      },
    });

    const alertas: AlertaLimiarRaw[] = [];

    // Ordem estável evita deadlock em FOR UPDATE de estoques distintos
    const itensOrdenados = [...input.itens].sort((a, b) =>
      a.produtoId.localeCompare(b.produtoId)
    );

    for (const item of itensOrdenados) {
      const produto = produtoMap.get(item.produtoId)!;
      let quantidade = item.quantidade;
      let series = produto.controlaSerie
        ? normalizarSeries(item.series)
        : [];
      if (produto.controlaSerie) {
        if (series.length === 0) {
          throw new AppError(
            400,
            `Produto ${produto.codigo} exige número(s) de série`
          );
        }
        quantidade = series.length;
      }

      await assertSaldoDisponivelOrigem(tx, {
        produtoId: item.produtoId,
        produtoCodigo: produto.codigo,
        origemFilialId,
        origemSigla: origem.sigla,
        quantidade,
        excludeTransferenciaId: null,
      });

      const itemRow = await tx.transferenciaItem.create({
        data: {
          transferenciaId: transf.id,
          produtoId: item.produtoId,
          qtdEnviada: quantidade,
          ...(!pendenteAprovacao && imediato
            ? { qtdRecebida: quantidade }
            : {}),
        },
      });

      if (pendenteAprovacao) {
        if (produto.controlaSerie) {
          await reservarSeriesTransferenciaPendente(tx, {
            transferenciaItemId: itemRow.id,
            produtoId: item.produtoId,
            origemFilialId,
            series,
            quantidade,
          });
        }
        continue;
      }

      const efeitos = await aplicarEfeitosItemTransferencia(tx, {
        userId: user.id,
        transfId: transf.id,
        itemId: itemRow.id,
        produto,
        quantidade,
        series,
        origemFilialId,
        destinoFilialId: input.destinoFilialId,
        origemNome: origem.nome,
        destinoNome: destino.nome,
        imediato,
        enviadaId: enviada.id,
        recebidaId: recebida.id,
      });
      alertas.push(...efeitos);
    }

    const completa = await tx.transferencia.findUniqueOrThrow({
      where: { id: transf.id },
      include: transfInclude,
    });

    return {
      transferencia: completa,
      alertasRaw: alertas,
      temDivergencia: false,
      creditoDestino,
      pendenteAprovacao,
    };
  });

  const alertasUi = emitirAlertasLimiaresTransferencia(result.alertasRaw);

  return {
    transferencia: result.transferencia,
    alertasEstoque: result.alertasRaw.filter(
      (a) => a.abaixoMinimo || a.acimaMaximo
    ),
    alertas: alertasUi,
    temDivergencia: false,
    creditoDestino: result.creditoDestino,
    pendenteAprovacao: result.pendenteAprovacao,
  };
}

type ProdutoMini = {
  id: string;
  codigo: string;
  descricao: string;
  controlaSerie: boolean;
  precoUnitario: import("@prisma/client").Prisma.Decimal | number;
};

async function aplicarEfeitosItemTransferencia(
  tx: import("@prisma/client").Prisma.TransactionClient,
  opts: {
    userId: string;
    transfId: string;
    itemId: string;
    produto: ProdutoMini;
    quantidade: number;
    series?: string[];
    origemFilialId: string;
    destinoFilialId: string;
    origemNome: string;
    destinoNome: string;
    imediato: boolean;
    enviadaId: string;
    recebidaId: string;
    /** Se true, séries já reservadas — só efetivar status */
    seriesJaReservadas?: boolean;
  }
) {
  const alertas: Array<{
    produtoId: string;
    produtoCodigo: string;
    produtoDescricao: string;
    abaixoMinimo: boolean;
    acimaMaximo: boolean;
    saldoAtual: number;
    filialNome: string;
  }> = [];

  const saldoOrigem = await aplicarSaldo(tx, {
    produtoId: opts.produto.id,
    filialId: opts.origemFilialId,
    operacao: "SAIDA",
    quantidade: opts.quantidade,
  });
  alertas.push({
    produtoId: opts.produto.id,
    produtoCodigo: opts.produto.codigo,
    produtoDescricao: opts.produto.descricao,
    abaixoMinimo: saldoOrigem.abaixoMinimo,
    acimaMaximo: saldoOrigem.acimaMaximo,
    saldoAtual: Number(saldoOrigem.saldoAtual),
    filialNome: opts.origemNome,
  });

  const movEnviada = await tx.movimentacao.create({
    data: {
      produtoId: opts.produto.id,
      tipoId: opts.enviadaId,
      usuarioId: opts.userId,
      filialId: opts.origemFilialId,
      filialDestinoId: opts.destinoFilialId,
      quantidade: opts.quantidade,
      precoUnitario: opts.produto.precoUnitario,
      operacao: "SAIDA",
      observacao: opts.imediato
        ? `Transferência ${opts.transfId.slice(0, 8)} (crédito imediato)`
        : `Transferência ${opts.transfId.slice(0, 8)} enviada`,
      status: "CONCLUIDO",
      transferenciaItemId: opts.itemId,
    },
  });

  let movRecebidaId: string | null = null;

  if (opts.imediato) {
    const saldoDest = await aplicarSaldo(tx, {
      produtoId: opts.produto.id,
      filialId: opts.destinoFilialId,
      operacao: "ENTRADA",
      quantidade: opts.quantidade,
    });
    alertas.push({
      produtoId: opts.produto.id,
      produtoCodigo: opts.produto.codigo,
      produtoDescricao: opts.produto.descricao,
      abaixoMinimo: saldoDest.abaixoMinimo,
      acimaMaximo: saldoDest.acimaMaximo,
      saldoAtual: Number(saldoDest.saldoAtual),
      filialNome: opts.destinoNome,
    });

    const movRecebida = await tx.movimentacao.create({
      data: {
        produtoId: opts.produto.id,
        tipoId: opts.recebidaId,
        usuarioId: opts.userId,
        filialId: opts.destinoFilialId,
        filialDestinoId: null,
        quantidade: opts.quantidade,
        precoUnitario: opts.produto.precoUnitario,
        operacao: "ENTRADA",
        observacao: `Transferência ${opts.transfId.slice(0, 8)} recebida (imediato)`,
        status: "CONCLUIDO",
        transferenciaItemId: opts.itemId,
      },
    });
    movRecebidaId = movRecebida.id;
  }

  if (opts.produto.controlaSerie) {
    if (opts.seriesJaReservadas) {
      await efetivarSeriesTransferenciaAposAprovacao(tx, {
        transferenciaItemId: opts.itemId,
        movimentacaoEnviadaId: movEnviada.id,
        movimentacaoRecebidaId: movRecebidaId,
        destinoFilialId: opts.destinoFilialId,
        imediato: opts.imediato,
      });
    } else {
      await aplicarSeriesTransferenciaEnvio(tx, {
        transferenciaItemId: opts.itemId,
        movimentacaoEnviadaId: movEnviada.id,
        movimentacaoRecebidaId: movRecebidaId,
        produtoId: opts.produto.id,
        origemFilialId: opts.origemFilialId,
        destinoFilialId: opts.destinoFilialId,
        series: opts.series || [],
        quantidade: opts.quantidade,
        imediato: opts.imediato,
      });
    }
  }

  return alertas;
}

/** Contagem para badge / Aprovações */
export async function contarTransferenciasPendentesAprovacao() {
  return prisma.transferencia.count({
    where: { status: "PENDENTE_APROVACAO" },
  });
}

export async function listarTransferenciasPendentesAprovacao() {
  return prisma.transferencia.findMany({
    where: { status: "PENDENTE_APROVACAO" },
    include: transfInclude,
    orderBy: { criadoEm: "desc" },
    take: 100,
  });
}

/** Gerente/Admin: aplica saldo e avança para EM_TRANSITO ou RECEBIDO */
export async function aprovarTransferencia(user: AuthUser, id: string) {
  if (user.perfil === "OPERADOR") {
    throw new AppError(403, "Apenas Admin ou Gerente podem aprovar");
  }

  const { enviada, recebida } = await tiposSistema();

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM transferencias WHERE id = ${id}::uuid FOR UPDATE`;

    const transf = await tx.transferencia.findUnique({
      where: { id },
      include: {
        itens: { include: { produto: true } },
        origemFilial: true,
        destinoFilial: true,
      },
    });
    if (!transf) throw new AppError(404, "Transferência não encontrada");
    if (transf.status !== "PENDENTE_APROVACAO") {
      throw new AppError(400, "Só é possível aprovar carga PENDENTE_APROVACAO");
    }
    if (
      transf.creditoDestino !== "IMEDIATO" &&
      transf.creditoDestino !== "AGUARDAR_RECEBIMENTO"
    ) {
      throw new AppError(
        400,
        "Transferência pendente sem creditoDestino válido — não é possível aprovar"
      );
    }

    const credito = transf.creditoDestino;
    const imediato = credito === "IMEDIATO";

    const alertas: AlertaLimiarRaw[] = [];

    const itensOrdenados = [...transf.itens].sort((a, b) =>
      a.produtoId.localeCompare(b.produtoId)
    );

    for (const item of itensOrdenados) {
      await assertSaldoDisponivelOrigem(tx, {
        produtoId: item.produtoId,
        produtoCodigo: item.produto.codigo,
        origemFilialId: transf.origemFilialId,
        origemSigla: transf.origemFilial.sigla,
        quantidade: Number(item.qtdEnviada),
        // Libera a reserva desta carga para poder baixar o estoque
        excludeTransferenciaId: transf.id,
      });

      const efeitos = await aplicarEfeitosItemTransferencia(tx, {
        userId: user.id,
        transfId: transf.id,
        itemId: item.id,
        produto: item.produto,
        quantidade: Number(item.qtdEnviada),
        origemFilialId: transf.origemFilialId,
        destinoFilialId: transf.destinoFilialId,
        origemNome: transf.origemFilial.nome,
        destinoNome: transf.destinoFilial.nome,
        imediato,
        enviadaId: enviada.id,
        recebidaId: recebida.id,
        seriesJaReservadas: item.produto.controlaSerie,
      });
      alertas.push(...efeitos);

      if (imediato) {
        await tx.transferenciaItem.update({
          where: { id: item.id },
          data: { qtdRecebida: item.qtdEnviada },
        });
      }
    }

    const updated = await tx.transferencia.update({
      where: { id },
      data: { status: imediato ? "RECEBIDO" : "EM_TRANSITO" },
      include: transfInclude,
    });

    return { transferencia: updated, alertasRaw: alertas, creditoDestino: credito };
  });

  const alertasUi = emitirAlertasLimiaresTransferencia(result.alertasRaw);

  return {
    transferencia: result.transferencia,
    creditoDestino: result.creditoDestino,
    alertas: alertasUi,
    alertaEstoqueMinimo: result.alertasRaw.some((a) => a.abaixoMinimo),
    alertaEstoqueMaximo: result.alertasRaw.some((a) => a.acimaMaximo),
  };
}

/** Gerente/Admin: rejeita pendente (sem mexer saldo) */
export async function rejeitarTransferencia(
  user: AuthUser,
  id: string,
  motivo?: string
) {
  if (user.perfil === "OPERADOR") {
    throw new AppError(403, "Apenas Admin ou Gerente podem rejeitar");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM transferencias WHERE id = ${id}::uuid FOR UPDATE`;
    const transf = await tx.transferencia.findUnique({
      where: { id },
      include: { itens: { select: { id: true } } },
    });
    if (!transf) throw new AppError(404, "Transferência não encontrada");
    if (transf.status !== "PENDENTE_APROVACAO") {
      throw new AppError(400, "Só é possível rejeitar carga PENDENTE_APROVACAO");
    }

    await tx.transferenciaItemSerie.deleteMany({
      where: {
        transferenciaItemId: { in: transf.itens.map((i) => i.id) },
      },
    });

    const updated = await tx.transferencia.update({
      where: { id },
      data: {
        status: "REJEITADO",
        motivoRejeicao: (motivo?.trim() || "Rejeitado na aprovação").slice(
          0,
          2000
        ),
      },
      include: transfInclude,
    });

    return { transferencia: updated };
  });
}

/** Destino confere: +destino com qtdRecebida; RECEBIDO ou PARCIAL */
export async function conferirTransferencia(
  user: AuthUser,
  id: string,
  input: {
    itens: Array<{
      itemId: string;
      qtdRecebida: number;
      seriesRecebidas?: string[];
      justificativa?: string | null;
    }>;
  }
) {
  const { recebida } = await tiposSistema();

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM transferencias WHERE id = ${id}::uuid FOR UPDATE`;

    const transf = await tx.transferencia.findUnique({
      where: { id },
      include: {
        itens: {
          include: {
            produto: true,
            series: { include: { unidadeSerie: true } },
          },
        },
      },
    });
    if (!transf) throw new AppError(404, "Transferência não encontrada");
    if (transf.status !== "EM_TRANSITO") {
      throw new AppError(400, "Só é possível conferir carga EM_TRANSITO");
    }
    assertFilialOperadorDestino(user, transf.destinoFilialId);

    if (input.itens.length !== transf.itens.length) {
      throw new AppError(
        400,
        "Informe a conferência de todos os itens da carga"
      );
    }

    const byId = new Map(transf.itens.map((i) => [i.id, i]));
    const seen = new Set<string>();
    let divergente = false;
    const divergencias: string[] = [];
    const alertas: Array<{
      produtoId: string;
      produtoCodigo: string;
      produtoDescricao: string;
      abaixoMinimo: boolean;
      acimaMaximo: boolean;
      saldoAtual: number;
    }> = [];

    // CONFERINDO marca intenção; commit só no fim (rollback se falhar)
    await tx.transferencia.update({
      where: { id },
      data: { status: "CONFERINDO" },
    });

    for (const conf of input.itens) {
      if (seen.has(conf.itemId)) {
        throw new AppError(400, "Item duplicado na conferência");
      }
      seen.add(conf.itemId);

      const item = byId.get(conf.itemId);
      if (!item) {
        throw new AppError(400, "Item não pertence a esta transferência");
      }

      const enviadaQtd = Number(item.qtdEnviada);
      let rec = Number(conf.qtdRecebida);
      let seriesRecebidas = item.produto.controlaSerie
        ? normalizarSeries(conf.seriesRecebidas)
        : [];

      if (item.produto.controlaSerie) {
        if (conf.seriesRecebidas === undefined && Number.isFinite(rec)) {
          // allow deriving from length if series provided
        }
        rec = seriesRecebidas.length;
      }

      if (!Number.isFinite(rec) || rec < 0) {
        throw new AppError(400, `Quantidade recebida inválida (${item.produto.codigo})`);
      }

      if (!qtdIguais(rec, enviadaQtd)) {
        divergente = true;
        if (!conf.justificativa?.trim()) {
          throw new AppError(
            400,
            `Divergência no produto ${item.produto.codigo}: justificativa obrigatória`
          );
        }
        divergencias.push(
          `${item.produto.codigo}: enviado ${enviadaQtd}, recebido ${rec}`
        );
      }

      let movRecebidaId: string | null = null;

      if (rec > 0) {
        const saldoResult = await aplicarSaldo(tx, {
          produtoId: item.produtoId,
          filialId: transf.destinoFilialId,
          operacao: "ENTRADA",
          quantidade: rec,
        });
        alertas.push({
          produtoId: item.produtoId,
          produtoCodigo: item.produto.codigo,
          produtoDescricao: item.produto.descricao,
          abaixoMinimo: saldoResult.abaixoMinimo,
          acimaMaximo: saldoResult.acimaMaximo,
          saldoAtual: Number(saldoResult.saldoAtual),
        });

        const movRec = await tx.movimentacao.create({
          data: {
            produtoId: item.produtoId,
            tipoId: recebida.id,
            usuarioId: user.id,
            filialId: transf.destinoFilialId,
            filialDestinoId: null,
            quantidade: rec,
            precoUnitario: item.produto.precoUnitario,
            operacao: "ENTRADA",
            observacao: !qtdIguais(rec, enviadaQtd)
              ? `Transferência ${transf.id.slice(0, 8)} parcial: ${conf.justificativa}`
              : `Transferência ${transf.id.slice(0, 8)} recebida`,
            status: "CONCLUIDO",
            transferenciaItemId: item.id,
          },
        });
        movRecebidaId = movRec.id;
      }

      if (item.produto.controlaSerie) {
        const { qtdNaoRecebida } = await aplicarSeriesConferencia(tx, {
          transferenciaItemId: item.id,
          movimentacaoRecebidaId: movRecebidaId,
          destinoFilialId: transf.destinoFilialId,
          origemFilialId: transf.origemFilialId,
          seriesRecebidas,
          qtdRecebida: rec,
        });
        // Séries não confirmadas voltam à origem — recredita saldo
        if (qtdNaoRecebida > 0) {
          const saldoOrig = await aplicarSaldo(tx, {
            produtoId: item.produtoId,
            filialId: transf.origemFilialId,
            operacao: "ENTRADA",
            quantidade: qtdNaoRecebida,
          });
          alertas.push({
            produtoId: item.produtoId,
            produtoCodigo: item.produto.codigo,
            produtoDescricao: item.produto.descricao,
            abaixoMinimo: saldoOrig.abaixoMinimo,
            acimaMaximo: saldoOrig.acimaMaximo,
            saldoAtual: Number(saldoOrig.saldoAtual),
          });
        }
      }

      await tx.transferenciaItem.update({
        where: { id: item.id },
        data: {
          qtdRecebida: rec,
          justificativaDivergencia: !qtdIguais(rec, enviadaQtd)
            ? conf.justificativa!.trim()
            : null,
        },
      });
    }

    const statusFinal = divergente ? "PARCIAL" : "RECEBIDO";
    const completa = await tx.transferencia.update({
      where: { id },
      data: { status: statusFinal },
      include: transfInclude,
    });

    return {
      transferencia: completa,
      temDivergencia: divergente,
      divergencias,
      alertasRaw: alertas,
    };
  });

  const alertasUi = emitirAlertasLimiaresTransferencia(
    result.alertasRaw.map((a) => ({
      ...a,
      filialNome: result.transferencia.destinoFilial.nome,
    }))
  );

  if (result.temDivergencia) {
    notificarDivergenciaTransferencia({
      transferenciaId: result.transferencia.id,
      origemNome: result.transferencia.origemFilial.nome,
      destinoNome: result.transferencia.destinoFilial.nome,
      resumoItens: result.divergencias.join("; "),
    });
    alertasUi.push({
      evento: "DIVERGENCIA_TRANSFERENCIA",
      mensagem: `Divergência registrada: ${result.divergencias.join("; ")}`,
    });
  }

  return {
    transferencia: result.transferencia,
    temDivergencia: result.temDivergencia,
    alertasEstoque: result.alertasRaw.filter(
      (a) => a.abaixoMinimo || a.acimaMaximo
    ),
    alertas: alertasUi,
  };
}

/**
 * Cancela carga EM_TRANSITO: devolve saldo à origem e marca movimentos enviados como ESTORNADO.
 */
export async function cancelarTransferencia(user: AuthUser, id: string) {
  if (user.perfil === "OPERADOR") {
    throw new AppError(
      403,
      "Operador não cancela transferência — peça ao Gerente"
    );
  }

  const { estorno, enviada } = await tiposSistema();

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM transferencias WHERE id = ${id}::uuid FOR UPDATE`;

    const transf = await tx.transferencia.findUnique({
      where: { id },
      include: {
        itens: {
          include: {
            produto: true,
            movimentacoes: true,
          },
        },
      },
    });
    if (!transf) throw new AppError(404, "Transferência não encontrada");
    if (transf.status === "PENDENTE_APROVACAO") {
      await tx.transferenciaItemSerie.deleteMany({
        where: {
          transferenciaItemId: { in: transf.itens.map((i) => i.id) },
        },
      });
      const updated = await tx.transferencia.update({
        where: { id },
        data: { status: "CANCELADO" },
        include: transfInclude,
      });
      return { transferencia: updated, alertasRaw: [] as never[] };
    }
    if (transf.status !== "EM_TRANSITO") {
      throw new AppError(
        400,
        "Só é possível cancelar carga EM_TRANSITO ou PENDENTE_APROVACAO"
      );
    }

    const alertas: Array<{
      produtoCodigo: string;
      produtoDescricao: string;
      abaixoMinimo: boolean;
      acimaMaximo: boolean;
      saldoAtual: number;
    }> = [];

    for (const item of transf.itens) {
      const enviadaMov = item.movimentacoes.find(
        (m) =>
          m.status === "CONCLUIDO" &&
          m.operacao === "SAIDA" &&
          m.tipoId === enviada.id
      );
      if (!enviadaMov) {
        throw new AppError(
          500,
          `Carga inconsistente: falta movimento de envio do produto ${item.produto.codigo}`
        );
      }

      const saldoResult = await aplicarSaldo(tx, {
        produtoId: item.produtoId,
        filialId: transf.origemFilialId,
        operacao: "ENTRADA",
        quantidade: Number(item.qtdEnviada),
      });
      alertas.push({
        produtoCodigo: item.produto.codigo,
        produtoDescricao: item.produto.descricao,
        abaixoMinimo: saldoResult.abaixoMinimo,
        acimaMaximo: saldoResult.acimaMaximo,
        saldoAtual: Number(saldoResult.saldoAtual),
      });

      const estornoMov = await tx.movimentacao.create({
        data: {
          produtoId: item.produtoId,
          tipoId: estorno.id,
          usuarioId: user.id,
          filialId: transf.origemFilialId,
          filialDestinoId: transf.destinoFilialId,
          quantidade: item.qtdEnviada,
          precoUnitario: item.produto.precoUnitario,
          operacao: "ENTRADA",
          observacao: `Cancelamento transferência ${transf.id.slice(0, 8)}`,
          status: "CONCLUIDO",
          estornoDeId: enviadaMov.id,
          transferenciaItemId: item.id,
        },
      });

      if (item.produto.controlaSerie) {
        const links = await tx.transferenciaItemSerie.findMany({
          where: { transferenciaItemId: item.id },
        });
        for (const link of links) {
          await tx.unidadeSerie.update({
            where: { id: link.unidadeSerieId },
            data: {
              status: SERIE_STATUS.EM_ESTOQUE,
              filialId: transf.origemFilialId,
              clienteId: null,
            },
          });
          await tx.movimentacaoSerie.create({
            data: {
              movimentacaoId: estornoMov.id,
              unidadeSerieId: link.unidadeSerieId,
            },
          });
        }
      }

      await tx.movimentacao.update({
        where: { id: enviadaMov.id },
        data: { status: "ESTORNADO" },
      });
    }

    const completa = await tx.transferencia.update({
      where: { id },
      data: { status: "CANCELADO" },
      include: transfInclude,
    });

    return { transferencia: completa, alertasRaw: alertas };
  });

  const alertasUi = emitirAlertasLimiaresTransferencia(
    result.alertasRaw.map((a) => ({
      ...a,
      filialNome: result.transferencia.origemFilial.nome,
    }))
  );

  return {
    transferencia: result.transferencia,
    alertas: alertasUi,
  };
}

/**
 * API legada POST /transferencias — respeita requerAprovacao do tipo
 * "Transferência entre estoques" (mesmo critério do Novo Lançamento).
 */
export async function criarTransferenciaViaApiLegada(
  user: AuthUser,
  input: {
    origemFilialId?: string;
    destinoFilialId: string;
    guiaTransporte?: string | null;
    creditoDestino?: "IMEDIATO" | "AGUARDAR_RECEBIMENTO";
    itens: Array<{ produtoId: string; quantidade: number; series?: string[] }>;
  }
) {
  const credito = input.creditoDestino || "AGUARDAR_RECEBIMENTO";
  const tipoLancamento = await prisma.tipoMovimentacao.findUnique({
    where: { nome: TIPO_TRANSF_ENTRE_ESTOQUES },
  });
  const precisaAprovacao =
    user.perfil === "OPERADOR" &&
    tipoLancamento?.requerAprovacao === true &&
    tipoLancamento.ativo;

  if (precisaAprovacao) {
    return criarTransferenciaPendenteAprovacao(user, input, credito);
  }
  if (credito === "IMEDIATO") {
    return criarTransferenciaImediata(user, input);
  }
  return criarTransferencia(user, input);
}
