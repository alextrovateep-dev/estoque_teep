import {
  TIPO_CONSUMO_MONTAGEM,
  TIPO_TRANSFORMACAO_ENTRADA,
  TIPO_TRANSFORMACAO_SAIDA,
} from "@teep/shared";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { assertOperadorPodeFilial, operadorFilialIds } from "../lib/filialScope";
import {
  aplicarSaldo,
  qtyReservadaTransferenciaPendente,
} from "./estoqueService";
import {
  assertSaldoComponentes,
  carregarBomProduto,
  linhasConsumoMontagem,
  type BomLinha,
} from "./montagemService";
import { alocarSeriesProduto } from "./geracaoSerieService";
import {
  aplicarSeriesEntrada,
  aplicarSeriesSaida,
  normalizarSeries,
  SERIE_STATUS,
} from "./serieService";

function normalizarSerie(s: string) {
  return normalizarSeries([s])[0]!;
}

async function tipoPorNome(nome: string) {
  const t = await prisma.tipoMovimentacao.findUnique({ where: { nome } });
  if (!t || !t.ativo) {
    throw new AppError(
      500,
      `Tipo sistema "${nome}" não configurado — rode o seed / reinicie a API`
    );
  }
  return t;
}

/** Linha do diff A→B (1 nível, não-fantasma). */
export type DiffBomDetalhe = {
  produtoFilhoId: string;
  codigo: string;
  descricao: string;
  qtdDestino: number;
  qtdOrigem: number;
  qtdBaixar: number;
  /** BAIXAR = delta > 0; COBERTO = já vem de A; EXCLUIDO = o próprio acabado A na BOM de B */
  motivo: "BAIXAR" | "COBERTO_ORIGEM" | "EXCLUIDO_ORIGEM_ACABADO";
};

/**
 * Diff de árvores 1 nível: baixa só o que B precisa além do que A já carrega.
 * Fantasma não cobre nem gera baixa. O SKU do acabado A na BOM de B nunca é baixado.
 */
export function diffBomTransformacao(
  bomOrigem: BomLinha[],
  bomDestino: BomLinha[],
  produtoOrigemId: string
): { detalhe: DiffBomDetalhe[]; bomDelta: BomLinha[] } {
  const qtdOrigemPorFilho = new Map<string, number>();
  for (const l of bomOrigem) {
    if (l.fantasma) continue;
    qtdOrigemPorFilho.set(
      l.produtoFilhoId,
      (qtdOrigemPorFilho.get(l.produtoFilhoId) || 0) + l.quantidade
    );
  }

  const detalhe: DiffBomDetalhe[] = [];
  const bomDelta: BomLinha[] = [];

  for (const l of bomDestino) {
    if (l.fantasma) continue;

    if (l.produtoFilhoId === produtoOrigemId) {
      detalhe.push({
        produtoFilhoId: l.produtoFilhoId,
        codigo: l.filho.codigo,
        descricao: l.filho.descricao,
        qtdDestino: l.quantidade,
        qtdOrigem: 0,
        qtdBaixar: 0,
        motivo: "EXCLUIDO_ORIGEM_ACABADO",
      });
      continue;
    }

    const qtdOrigem = qtdOrigemPorFilho.get(l.produtoFilhoId) || 0;
    const qtdBaixar = Math.max(0, l.quantidade - qtdOrigem);
    const motivo: DiffBomDetalhe["motivo"] =
      qtdBaixar > 1e-9 ? "BAIXAR" : "COBERTO_ORIGEM";

    detalhe.push({
      produtoFilhoId: l.produtoFilhoId,
      codigo: l.filho.codigo,
      descricao: l.filho.descricao,
      qtdDestino: l.quantidade,
      qtdOrigem,
      qtdBaixar,
      motivo,
    });

    if (qtdBaixar > 1e-9) {
      bomDelta.push({
        ...l,
        quantidade: qtdBaixar,
      });
    }
  }

  return { detalhe, bomDelta };
}

export type PreviewTransformacao = {
  produtoOrigem: { id: string; codigo: string; descricao: string };
  produtoDestino: { id: string; codigo: string; descricao: string };
  filial: { id: string; sigla: string; nome: string };
  /** Todas as linhas relevantes (baixar + cobertas + excluídas). */
  linhas: Array<
    DiffBomDetalhe & {
      saldoDisponivel: number;
      faltante: number;
    }
  >;
  /** Só o que sai do estoque. */
  aBaixar: Array<
    DiffBomDetalhe & {
      saldoDisponivel: number;
      faltante: number;
    }
  >;
  /** Componentes em A que B não usa — saem com A, não voltam ao estoque. */
  sobrasOrigem: Array<{
    produtoFilhoId: string;
    codigo: string;
    descricao: string;
    quantidade: number;
  }>;
  bomOrigemVazia: boolean;
  avisos: string[];
  okSaldo: boolean;
  faltantes: { codigo: string; faltante: number }[];
};

export async function previewTransformacao(opts: {
  filialId: string;
  produtoOrigemId: string;
  produtoDestinoId: string;
}): Promise<PreviewTransformacao> {
  const filial = await prisma.filial.findFirst({
    where: { id: opts.filialId, ativo: true },
    select: { id: true, sigla: true, nome: true },
  });
  if (!filial) throw new AppError(400, "Estoque inválido ou inativo");

  if (!opts.produtoOrigemId?.trim()) {
    throw new AppError(400, "produtoOrigemId é obrigatório para o diff");
  }

  const [origem, destino] = await Promise.all([
    prisma.produto.findFirst({
      where: { id: opts.produtoOrigemId, ativo: true },
      select: { id: true, codigo: true, descricao: true },
    }),
    prisma.produto.findFirst({
      where: { id: opts.produtoDestinoId, ativo: true },
      select: { id: true, codigo: true, descricao: true },
    }),
  ]);
  if (!origem) throw new AppError(400, "Produto origem inválido ou inativo");
  if (!destino) throw new AppError(400, "Produto destino inválido ou inativo");

  const bomDestino = await carregarBomProduto(prisma, destino.id);
  if (!bomDestino.length) {
    throw new AppError(
      400,
      `Produto ${destino.codigo} não tem árvore de componentes. Cadastre a BOM antes de transformar.`
    );
  }

  const bomOrigem = await carregarBomProduto(prisma, origem.id);
  const bomOrigemVazia = bomOrigem.filter((l) => !l.fantasma).length === 0;

  const { detalhe } = diffBomTransformacao(bomOrigem, bomDestino, origem.id);

  const filhosDestino = new Set(
    bomDestino.filter((l) => !l.fantasma).map((l) => l.produtoFilhoId)
  );
  const sobrasOrigem = bomOrigem
    .filter(
      (l) =>
        !l.fantasma &&
        l.produtoFilhoId !== destino.id &&
        !filhosDestino.has(l.produtoFilhoId)
    )
    .map((l) => ({
      produtoFilhoId: l.produtoFilhoId,
      codigo: l.filho.codigo,
      descricao: l.filho.descricao,
      quantidade: l.quantidade,
    }));

  const linhas = [];
  for (const d of detalhe) {
    if (d.motivo !== "BAIXAR") {
      linhas.push({
        ...d,
        saldoDisponivel: 0,
        faltante: 0,
      });
      continue;
    }
    const est = await prisma.estoque.findUnique({
      where: {
        uniq_produto_filial: {
          produtoId: d.produtoFilhoId,
          filialId: filial.id,
        },
      },
    });
    const bruto = est ? Number(est.saldoAtual) : 0;
    const reservada = await qtyReservadaTransferenciaPendente(
      prisma,
      d.produtoFilhoId,
      filial.id
    );
    const saldoDisponivel = Math.max(0, bruto - reservada);
    const faltante = Math.max(0, d.qtdBaixar - saldoDisponivel);
    linhas.push({ ...d, saldoDisponivel, faltante });
  }

  const aBaixar = linhas.filter((l) => l.motivo === "BAIXAR");
  const faltantes = aBaixar
    .filter((l) => l.faltante > 0)
    .map((l) => ({ codigo: l.codigo, faltante: l.faltante }));

  const avisos: string[] = [];
  if (bomOrigemVazia) {
    avisos.push(
      `A árvore de ${origem.codigo} está vazia (ou só fantasmas). O diff não cobre nenhum componente — a baixa usa a árvore inteira de ${destino.codigo}. Cadastre a BOM de A se componentes já estiverem “dentro” do acabado.`
    );
  }
  if (sobrasOrigem.length > 0) {
    avisos.push(
      `Componentes só em ${origem.codigo} (${sobrasOrigem
        .map((s) => s.codigo)
        .join(", ")}) saem com A e não voltam ao estoque.`
    );
  }
  avisos.push(
    "O diff compara só 1 nível da árvore (não explode kits em peças internas)."
  );

  return {
    produtoOrigem: origem,
    produtoDestino: destino,
    filial,
    linhas,
    aBaixar,
    sobrasOrigem,
    bomOrigemVazia,
    avisos,
    okSaldo: faltantes.length === 0,
    faltantes,
  };
}

export type CriarTransformacaoInput = {
  filialId: string;
  produtoOrigemId: string;
  numeroSerieOrigem: string;
  produtoDestinoId: string;
  numeroSerieDestino?: string | null;
  observacao?: string | null;
};

/**
 * Acabado A (N/S) morre → produto B nasce (N/S novo).
 * Baixa só o delta da árvore B − A (componentes que B precisa além dos de A).
 * Histórico em produto_transformacoes.
 */
export async function criarTransformacao(
  user: AuthUser,
  input: CriarTransformacaoInput
) {
  assertOperadorPodeFilial(user, input.filialId);

  if (input.produtoOrigemId === input.produtoDestinoId) {
    throw new AppError(400, "Produto origem e destino devem ser diferentes");
  }

  const filial = await prisma.filial.findFirst({
    where: { id: input.filialId, ativo: true },
    select: { id: true, sigla: true, nome: true },
  });
  if (!filial) throw new AppError(400, "Estoque inválido ou inativo");

  const [origem, destino] = await Promise.all([
    prisma.produto.findFirst({
      where: { id: input.produtoOrigemId, ativo: true },
      select: {
        id: true,
        codigo: true,
        descricao: true,
        controlaSerie: true,
        precoUnitario: true,
      },
    }),
    prisma.produto.findFirst({
      where: { id: input.produtoDestinoId, ativo: true },
      select: {
        id: true,
        codigo: true,
        descricao: true,
        controlaSerie: true,
        precoUnitario: true,
      },
    }),
  ]);
  if (!origem) throw new AppError(400, "Produto origem inválido ou inativo");
  if (!destino) throw new AppError(400, "Produto destino inválido ou inativo");
  if (!origem.controlaSerie) {
    throw new AppError(
      400,
      `Produto origem ${origem.codigo} não controla número de série`
    );
  }
  if (!destino.controlaSerie) {
    throw new AppError(
      400,
      `Produto destino ${destino.codigo} deve controlar número de série`
    );
  }

  const serieOrigem = normalizarSerie(input.numeroSerieOrigem);

  let serieDestino: string;
  let alocacaoId: string | null = null;
  if (input.numeroSerieDestino?.trim()) {
    serieDestino = normalizarSerie(input.numeroSerieDestino);
  } else {
    const aloc = await alocarSeriesProduto({
      produtoId: destino.id,
      quantidade: 1,
      usuarioId: user.id,
    });
    serieDestino = String(aloc.series[0]);
    alocacaoId = aloc.alocacaoId;
  }

  const tipoSaida = await tipoPorNome(TIPO_TRANSFORMACAO_SAIDA);
  const tipoEntrada = await tipoPorNome(TIPO_TRANSFORMACAO_ENTRADA);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const unidadeOrigem = await tx.unidadeSerie.findFirst({
        where: {
          produtoId: origem.id,
          numeroSerie: { equals: serieOrigem, mode: "insensitive" },
        },
      });
      if (!unidadeOrigem) {
        throw new AppError(
          400,
          `Série ${serieOrigem} não encontrada para ${origem.codigo}`
        );
      }
      if (
        unidadeOrigem.status !== SERIE_STATUS.EM_ESTOQUE ||
        unidadeOrigem.filialId !== filial.id
      ) {
        throw new AppError(
          400,
          `Série ${serieOrigem} não está disponível em ${filial.sigla}`
        );
      }

      // Usa o N/S canônico cadastrado (evita mismatch de caixa no unique)
      const serieOrigemCanon = unidadeOrigem.numeroSerie;

      const bomDestino = await carregarBomProduto(tx, destino.id);
      if (!bomDestino.length) {
        throw new AppError(
          400,
          `Produto ${destino.codigo} não tem árvore de componentes. Cadastre a BOM antes de transformar.`
        );
      }
      const bomOrigem = await carregarBomProduto(tx, origem.id);
      const { bomDelta } = diffBomTransformacao(
        bomOrigem,
        bomDestino,
        origem.id
      );
      const consumo =
        bomDelta.length > 0 ? linhasConsumoMontagem(bomDelta, 1) : [];

      if (consumo.length > 0) {
        await assertSaldoComponentes(tx, {
          filialComponentesId: filial.id,
          consumo,
        });
      }

      const obs =
        input.observacao?.trim() ||
        `Transformação ${origem.codigo} (${serieOrigemCanon}) → ${destino.codigo}`;

      await aplicarSaldo(tx, {
        produtoId: origem.id,
        filialId: filial.id,
        operacao: "SAIDA",
        quantidade: 1,
      });

      const movSaida = await tx.movimentacao.create({
        data: {
          produtoId: origem.id,
          tipoId: tipoSaida.id,
          usuarioId: user.id,
          filialId: filial.id,
          filialComponentesId: filial.id,
          quantidade: 1,
          precoUnitario: origem.precoUnitario,
          operacao: "SAIDA",
          status: "CONCLUIDO",
          observacao: obs,
          seriesInformadas: [serieOrigemCanon],
        },
      });

      await aplicarSeriesSaida(tx, {
        movimentacaoId: movSaida.id,
        produtoId: origem.id,
        filialId: filial.id,
        series: [serieOrigemCanon],
        quantidade: 1,
      });

      await aplicarSaldo(tx, {
        produtoId: destino.id,
        filialId: filial.id,
        operacao: "ENTRADA",
        quantidade: 1,
      });

      const movEntrada = await tx.movimentacao.create({
        data: {
          produtoId: destino.id,
          tipoId: tipoEntrada.id,
          usuarioId: user.id,
          filialId: filial.id,
          quantidade: 1,
          precoUnitario: destino.precoUnitario,
          operacao: "ENTRADA",
          status: "CONCLUIDO",
          observacao: obs,
          seriesInformadas: [serieDestino],
        },
      });

      await aplicarSeriesEntrada(tx, {
        movimentacaoId: movEntrada.id,
        produtoId: destino.id,
        filialId: filial.id,
        series: [serieDestino],
        quantidade: 1,
        permitirReativarSaido: false,
      });

      const unidadeDestino = await tx.unidadeSerie.findFirst({
        where: {
          produtoId: destino.id,
          numeroSerie: { equals: serieDestino, mode: "insensitive" },
        },
      });
      if (!unidadeDestino) {
        throw new AppError(
          500,
          `Falha ao registrar série destino ${serieDestino}`
        );
      }

      const consumos: string[] = [];
      if (consumo.length > 0) {
        let tipoConsumo = await tx.tipoMovimentacao.findUnique({
          where: { nome: TIPO_CONSUMO_MONTAGEM },
        });
        if (!tipoConsumo) {
          tipoConsumo = await tx.tipoMovimentacao.findUnique({
            where: { nome: "Consumo Montagem" },
          });
        }
        if (!tipoConsumo) {
          throw new AppError(
            500,
            `Tipo sistema "${TIPO_CONSUMO_MONTAGEM}" não configurado`
          );
        }
        for (const c of consumo) {
          await aplicarSaldo(tx, {
            produtoId: c.produtoId,
            filialId: filial.id,
            operacao: "SAIDA",
            quantidade: c.quantidade,
          });
          const mov = await tx.movimentacao.create({
            data: {
              produtoId: c.produtoId,
              tipoId: tipoConsumo.id,
              usuarioId: user.id,
              filialId: filial.id,
              quantidade: c.quantidade,
              precoUnitario: c.precoUnitario,
              operacao: "SAIDA",
              status: "CONCLUIDO",
              movimentacaoMontagemId: movEntrada.id,
              observacao: obs,
            },
          });
          consumos.push(mov.id);
        }
      }

      const transformacao = await tx.produtoTransformacao.create({
        data: {
          usuarioId: user.id,
          filialId: filial.id,
          produtoOrigemId: origem.id,
          unidadeSerieOrigemId: unidadeOrigem.id,
          numeroSerieOrigem: serieOrigemCanon,
          produtoDestinoId: destino.id,
          unidadeSerieDestinoId: unidadeDestino.id,
          numeroSerieDestino: unidadeDestino.numeroSerie,
          movimentacaoSaidaOrigemId: movSaida.id,
          movimentacaoEntradaDestinoId: movEntrada.id,
          observacao: input.observacao?.trim() || null,
        },
      });

      return {
        transformacao,
        origem: {
          codigo: origem.codigo,
          descricao: origem.descricao,
          numeroSerie: serieOrigemCanon,
        },
        destino: {
          codigo: destino.codigo,
          descricao: destino.descricao,
          numeroSerie: unidadeDestino.numeroSerie,
        },
        filial,
        consumosComponentes: consumos.length,
      };
    });

    console.log(
      JSON.stringify({
        event: "produto_transformacao",
        id: result.transformacao.id,
        userId: user.id,
        filialId: filial.id,
        origem: result.origem.codigo,
        destino: result.destino.codigo,
      })
    );

    return {
      ok: true as const,
      id: result.transformacao.id,
      criadoEm: result.transformacao.criadoEm,
      filial: result.filial,
      origem: result.origem,
      destino: result.destino,
      consumosComponentes: result.consumosComponentes,
      mensagem: `${result.origem.codigo} (${result.origem.numeroSerie}) transformado em ${result.destino.codigo} (${result.destino.numeroSerie}).`,
    };
  } catch (e) {
    if (alocacaoId) {
      await prisma.serieAlocacao
        .updateMany({
          where: { id: alocacaoId, status: "PENDENTE" },
          data: { status: "CANCELADA" },
        })
        .catch(() => undefined);
    }
    throw e;
  }
}

export async function listarTransformacoes(
  user: AuthUser,
  opts: {
    filialId?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }
) {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize || 20));
  if (opts.filialId) assertOperadorPodeFilial(user, opts.filialId);

  const opFiliais =
    user.perfil === "OPERADOR" ? operadorFilialIds(user) : null;
  if (opFiliais && opFiliais.length === 0) {
    throw new AppError(403, "Operador sem filial");
  }

  const q = (opts.q || "").trim();
  const where = {
    ...(opts.filialId
      ? { filialId: opts.filialId }
      : opFiliais
        ? { filialId: { in: opFiliais } }
        : {}),
    ...(q
      ? {
          OR: [
            { numeroSerieOrigem: { contains: q, mode: "insensitive" as const } },
            {
              numeroSerieDestino: { contains: q, mode: "insensitive" as const },
            },
            {
              produtoOrigem: {
                codigo: { contains: q, mode: "insensitive" as const },
              },
            },
            {
              produtoDestino: {
                codigo: { contains: q, mode: "insensitive" as const },
              },
            },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.produtoTransformacao.count({ where }),
    prisma.produtoTransformacao.findMany({
      where,
      orderBy: { criadoEm: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        filial: { select: { id: true, sigla: true, nome: true } },
        produtoOrigem: {
          select: { id: true, codigo: true, descricao: true },
        },
        produtoDestino: {
          select: { id: true, codigo: true, descricao: true },
        },
        usuario: { select: { id: true, nome: true } },
      },
    }),
  ]);

  return { total, page, pageSize, rows };
}

/** Histórico de transformação envolvendo uma unidade de série. */
export async function historicoTransformacaoPorSerie(unidadeSerieId: string) {
  const [comoOrigem, comoDestino] = await Promise.all([
    prisma.produtoTransformacao.findMany({
      where: { unidadeSerieOrigemId: unidadeSerieId },
      orderBy: { criadoEm: "desc" },
      include: {
        produtoDestino: {
          select: { id: true, codigo: true, descricao: true },
        },
        filial: { select: { sigla: true, nome: true } },
      },
    }),
    prisma.produtoTransformacao.findMany({
      where: { unidadeSerieDestinoId: unidadeSerieId },
      orderBy: { criadoEm: "desc" },
      include: {
        produtoOrigem: {
          select: { id: true, codigo: true, descricao: true },
        },
        filial: { select: { sigla: true, nome: true } },
      },
    }),
  ]);

  return {
    transformadoEm: comoOrigem.map((t) => ({
      id: t.id,
      criadoEm: t.criadoEm,
      numeroSerieDestino: t.numeroSerieDestino,
      produtoDestino: t.produtoDestino,
      filial: t.filial,
    })),
    originadoDe: comoDestino.map((t) => ({
      id: t.id,
      criadoEm: t.criadoEm,
      numeroSerieOrigem: t.numeroSerieOrigem,
      produtoOrigem: t.produtoOrigem,
      filial: t.filial,
    })),
  };
}
