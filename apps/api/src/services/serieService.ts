import { Prisma } from "@prisma/client";
import {
  clampTamanhoSequencial,
  prefixoSerieProduto,
  sequenciaDeSerieCompleta,
  serieCompletaDeSequencia,
  validarSequenciaSerieTamanho,
} from "@teep/shared";
import { AppError } from "../middleware/error";
import {
  confirmarAlocacoesPorIds,
  prepararEntradaComAlocacoes,
} from "./geracaoSerieService";

type Tx = Prisma.TransactionClient;

export const SERIE_STATUS = {
  EM_ESTOQUE: "EM_ESTOQUE",
  EM_TRANSITO: "EM_TRANSITO",
  SAIDO: "SAIDO",
} as const;

export type SerieStatus = (typeof SERIE_STATUS)[keyof typeof SERIE_STATUS];

/** Normaliza lista: trim, remove vazios, rejeita duplicatas no payload. */
export function normalizarSeries(raw: string[] | undefined | null): string[] {
  if (!raw?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    const t = String(s ?? "").trim();
    if (!t) continue;
    if (t.length > 80) {
      throw new AppError(400, `Número de série inválido (máx. 80): ${t.slice(0, 20)}…`);
    }
    const key = t.toUpperCase();
    if (seen.has(key)) {
      throw new AppError(400, `Número de série duplicado no lançamento: ${t}`);
    }
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function assertQuantidadeInteiraSerie(quantidade: number, seriesLen: number) {
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    throw new AppError(
      400,
      "Produto com controle de série exige quantidade inteira positiva"
    );
  }
  if (seriesLen !== quantidade) {
    throw new AppError(
      400,
      `Informe exatamente ${quantidade} número(s) de série (recebido: ${seriesLen})`
    );
  }
}

/**
 * Garante que cada série respeita o tamanho de sequência do produto
 * (ex.: 4 dígitos → …0023, não …000023).
 */
export async function assertFormatoSeriesNascimento(
  tx: Tx,
  produtoId: string,
  series: string[]
) {
  const produto = await tx.produto.findUnique({
    where: { id: produtoId },
    include: { configuracaoSerie: true },
  });
  if (!produto?.controlaSerie) return;

  const cfg = produto.configuracaoSerie;
  const tamanho = clampTamanhoSequencial(cfg?.tamanhoSequencial);
  const prefixo = prefixoSerieProduto({
    codigoProduto: produto.codigo,
    formato: cfg?.formato,
    tamanhoSequencial: tamanho,
    prefixoFixo: cfg?.prefixoFixo,
    sufixoFixo: cfg?.sufixoFixo,
  });
  const sufixo = cfg?.sufixoFixo ?? null;

  for (const sn of series) {
    const seq = sequenciaDeSerieCompleta(sn, prefixo, sufixo);
    const check = validarSequenciaSerieTamanho(seq, tamanho);
    if (!check.ok) {
      throw new AppError(400, `Série ${sn}: ${check.motivo}`);
    }
    const esperado = serieCompletaDeSequencia(
      prefixo,
      seq,
      tamanho,
      sufixo,
      { finalizar: true }
    );
    if (esperado.toUpperCase() !== sn.toUpperCase()) {
      throw new AppError(
        400,
        `Série ${sn} não confere com o padrão do produto (esperado ${esperado})`
      );
    }
  }
}

async function assertSerieNaoExisteNoProduto(
  tx: Tx,
  produtoId: string,
  numeroSerie: string
) {
  const existente = await tx.unidadeSerie.findFirst({
    where: {
      produtoId,
      numeroSerie: { equals: numeroSerie, mode: "insensitive" },
    },
    select: { numeroSerie: true, status: true },
  });
  if (existente) {
    throw new AppError(
      400,
      `Número de série já cadastrado para este produto: ${existente.numeroSerie}`
    );
  }
}

/** Séries já reservadas em movimentações PENDENTE (seriesInformadas). */
async function seriesReservadasPendentes(
  tx: Tx,
  produtoId: string,
  excludeMovimentacaoId?: string | null
): Promise<Set<string>> {
  const pendentes = await tx.movimentacao.findMany({
    where: {
      produtoId,
      status: "PENDENTE",
      ...(excludeMovimentacaoId ? { id: { not: excludeMovimentacaoId } } : {}),
    },
    select: { seriesInformadas: true },
  });
  const set = new Set<string>();
  for (const m of pendentes) {
    const arr = Array.isArray(m.seriesInformadas)
      ? (m.seriesInformadas as string[])
      : [];
    for (const s of arr) set.add(String(s).trim().toUpperCase());
  }
  return set;
}

async function seriesEmTransferenciaPendente(
  tx: Tx,
  produtoId: string,
  excludeTransferenciaId?: string | null
): Promise<Set<string>> {
  const rows = await tx.transferenciaItemSerie.findMany({
    where: {
      unidadeSerie: { produtoId },
      transferenciaItem: {
        transferencia: {
          status: "PENDENTE_APROVACAO",
          ...(excludeTransferenciaId
            ? { id: { not: excludeTransferenciaId } }
            : {}),
        },
      },
    },
    include: { unidadeSerie: { select: { numeroSerie: true } } },
  });
  return new Set(rows.map((r) => r.unidadeSerie.numeroSerie.toUpperCase()));
}

export async function assertPodeAtivarControlaSerie(
  tx: Tx,
  produtoId: string
) {
  const estoques = await tx.estoque.findMany({
    where: { produtoId, saldoAtual: { gt: 0 } },
  });
  if (estoques.length === 0) return;

  for (const e of estoques) {
    const count = await tx.unidadeSerie.count({
      where: {
        produtoId,
        filialId: e.filialId,
        status: SERIE_STATUS.EM_ESTOQUE,
      },
    });
    const saldo = Number(e.saldoAtual);
    if (Math.abs(count - saldo) > 1e-9) {
      throw new AppError(
        400,
        "Não é possível ativar controle de série: há saldo sem unidades de série correspondentes. Zere o saldo ou registre as séries no inventário."
      );
    }
  }
}

/**
 * Entrada (ou inventário): cria/reativa unidades EM_ESTOQUE e vincula à movimentação.
 * Reativa se a série já existia como SAIDO (retorno genérico sem vínculo).
 */
export async function aplicarSeriesEntrada(
  tx: Tx,
  opts: {
    movimentacaoId: string;
    produtoId: string;
    filialId: string;
    series: string[];
    quantidade: number;
    /** Se true, reativa SAIDO → EM_ESTOQUE (retorno). Se false, rejeita série já existente. */
    permitirReativarSaido?: boolean;
  }
) {
  const series = normalizarSeries(opts.series);
  assertQuantidadeInteiraSerie(opts.quantidade, series.length);

  if (!opts.permitirReativarSaido) {
    await assertFormatoSeriesNascimento(tx, opts.produtoId, series);
  }

  const alocacoesParaConfirmar = await prepararEntradaComAlocacoes(tx, {
    produtoId: opts.produtoId,
    series,
  });

  for (const numeroSerie of series) {
    const existente = await tx.unidadeSerie.findFirst({
      where: {
        produtoId: opts.produtoId,
        numeroSerie: { equals: numeroSerie, mode: "insensitive" },
      },
    });

    let unidadeId: string;

    if (existente) {
      if (
        opts.permitirReativarSaido &&
        existente.status === SERIE_STATUS.SAIDO
      ) {
        const updated = await tx.unidadeSerie.update({
          where: { id: existente.id },
          data: {
            status: SERIE_STATUS.EM_ESTOQUE,
            filialId: opts.filialId,
            clienteId: null,
          },
        });
        unidadeId = updated.id;
      } else {
        throw new AppError(
          400,
          `Número de série já cadastrado para este produto: ${existente.numeroSerie}`
        );
      }
    } else {
      const created = await tx.unidadeSerie.create({
        data: {
          produtoId: opts.produtoId,
          numeroSerie,
          filialId: opts.filialId,
          status: SERIE_STATUS.EM_ESTOQUE,
        },
      });
      unidadeId = created.id;
    }

    await tx.movimentacaoSerie.create({
      data: {
        movimentacaoId: opts.movimentacaoId,
        unidadeSerieId: unidadeId,
      },
    });
  }

  await confirmarAlocacoesPorIds(tx, alocacoesParaConfirmar);
}

/**
 * Retorno vinculado: séries devem estar SAIDO e preferencialmente na saída origem.
 * Só valida — não altera estado (use em PENDENTE).
 */
export async function validarSeriesRetorno(
  tx: Tx,
  opts: {
    produtoId: string;
    series: string[];
    quantidade: number;
    movimentacaoOrigemId: string;
    clienteId?: string | null;
  }
) {
  const series = normalizarSeries(opts.series);
  assertQuantidadeInteiraSerie(opts.quantidade, series.length);

  const origemLinks = await tx.movimentacaoSerie.findMany({
    where: { movimentacaoId: opts.movimentacaoOrigemId },
    include: { unidadeSerie: true },
  });
  const origemBySerie = new Map(
    origemLinks.map((l) => [
      l.unidadeSerie.numeroSerie.toUpperCase(),
      l.unidadeSerie,
    ])
  );
  const temSeriesNaOrigem = origemLinks.length > 0;

  for (const numeroSerie of series) {
    const key = numeroSerie.toUpperCase();
    const unidade = await tx.unidadeSerie.findUnique({
      where: {
        uniq_produto_serie: {
          produtoId: opts.produtoId,
          numeroSerie,
        },
      },
    });

    if (!unidade) {
      throw new AppError(400, `Série não encontrada: ${numeroSerie}`);
    }
    if (unidade.status !== SERIE_STATUS.SAIDO) {
      throw new AppError(
        400,
        `Série ${numeroSerie} não está saída (status: ${unidade.status})`
      );
    }
    if (temSeriesNaOrigem && !origemBySerie.has(key)) {
      throw new AppError(
        400,
        `Série ${numeroSerie} não pertence à saída vinculada`
      );
    }
    if (
      opts.clienteId &&
      unidade.clienteId &&
      unidade.clienteId !== opts.clienteId
    ) {
      throw new AppError(
        400,
        `Série ${numeroSerie} está vinculada a outro cliente`
      );
    }
  }
  return series;
}

/**
 * Retorno vinculado: séries devem estar SAIDO e preferencialmente na saída origem.
 */
export async function aplicarSeriesRetorno(
  tx: Tx,
  opts: {
    movimentacaoId: string;
    produtoId: string;
    filialId: string;
    series: string[];
    quantidade: number;
    movimentacaoOrigemId: string;
    clienteId?: string | null;
  }
) {
  await validarSeriesRetorno(tx, {
    produtoId: opts.produtoId,
    series: opts.series,
    quantidade: opts.quantidade,
    movimentacaoOrigemId: opts.movimentacaoOrigemId,
    clienteId: opts.clienteId,
  });

  const series = normalizarSeries(opts.series);

  for (const numeroSerie of series) {
    const unidade = await tx.unidadeSerie.findUnique({
      where: {
        uniq_produto_serie: {
          produtoId: opts.produtoId,
          numeroSerie,
        },
      },
    });
    if (!unidade) {
      throw new AppError(400, `Série não encontrada: ${numeroSerie}`);
    }

    await tx.unidadeSerie.update({
      where: { id: unidade.id },
      data: {
        status: SERIE_STATUS.EM_ESTOQUE,
        filialId: opts.filialId,
        clienteId: null,
      },
    });

    await tx.movimentacaoSerie.create({
      data: {
        movimentacaoId: opts.movimentacaoId,
        unidadeSerieId: unidade.id,
      },
    });
  }
}

export async function aplicarSeriesSaida(
  tx: Tx,
  opts: {
    movimentacaoId: string;
    produtoId: string;
    filialId: string;
    series: string[];
    quantidade: number;
    clienteId?: string | null;
    excludeMovimentacaoId?: string | null;
  }
) {
  const series = normalizarSeries(opts.series);
  assertQuantidadeInteiraSerie(opts.quantidade, series.length);

  const reservadas = await seriesReservadasPendentes(
    tx,
    opts.produtoId,
    opts.excludeMovimentacaoId
  );
  const emPendTransf = await seriesEmTransferenciaPendente(tx, opts.produtoId);

  for (const numeroSerie of series) {
    const key = numeroSerie.toUpperCase();
    if (reservadas.has(key) || emPendTransf.has(key)) {
      throw new AppError(
        400,
        `Série ${numeroSerie} está reservada em outro lançamento pendente`
      );
    }

    const unidade = await tx.unidadeSerie.findUnique({
      where: {
        uniq_produto_serie: {
          produtoId: opts.produtoId,
          numeroSerie,
        },
      },
    });
    if (!unidade) {
      throw new AppError(400, `Série não encontrada: ${numeroSerie}`);
    }
    if (
      unidade.status !== SERIE_STATUS.EM_ESTOQUE ||
      unidade.filialId !== opts.filialId
    ) {
      throw new AppError(
        400,
        `Série ${numeroSerie} não está disponível neste estoque`
      );
    }

    await tx.unidadeSerie.update({
      where: { id: unidade.id },
      data: {
        status: SERIE_STATUS.SAIDO,
        filialId: null,
        clienteId: opts.clienteId || null,
      },
    });

    await tx.movimentacaoSerie.create({
      data: {
        movimentacaoId: opts.movimentacaoId,
        unidadeSerieId: unidade.id,
      },
    });
  }
}

/** Valida séries de saída sem aplicar (PENDENTE). */
export async function validarSeriesSaidaDisponiveis(
  tx: Tx,
  opts: {
    produtoId: string;
    filialId: string;
    series: string[];
    quantidade: number;
    excludeMovimentacaoId?: string | null;
  }
) {
  const series = normalizarSeries(opts.series);
  assertQuantidadeInteiraSerie(opts.quantidade, series.length);

  const reservadas = await seriesReservadasPendentes(
    tx,
    opts.produtoId,
    opts.excludeMovimentacaoId
  );
  const emPendTransf = await seriesEmTransferenciaPendente(tx, opts.produtoId);

  for (const numeroSerie of series) {
    const key = numeroSerie.toUpperCase();
    if (reservadas.has(key) || emPendTransf.has(key)) {
      throw new AppError(
        400,
        `Série ${numeroSerie} está reservada em outro lançamento pendente`
      );
    }
    const unidade = await tx.unidadeSerie.findUnique({
      where: {
        uniq_produto_serie: {
          produtoId: opts.produtoId,
          numeroSerie,
        },
      },
    });
    if (
      !unidade ||
      unidade.status !== SERIE_STATUS.EM_ESTOQUE ||
      unidade.filialId !== opts.filialId
    ) {
      throw new AppError(
        400,
        `Série ${numeroSerie} não está disponível neste estoque`
      );
    }
  }
  return series;
}

export async function validarSeriesEntradaNovas(
  tx: Tx,
  opts: {
    produtoId: string;
    series: string[];
    quantidade: number;
    permitirReativarSaido?: boolean;
  }
) {
  const series = normalizarSeries(opts.series);
  assertQuantidadeInteiraSerie(opts.quantidade, series.length);
  if (!opts.permitirReativarSaido) {
    await assertFormatoSeriesNascimento(tx, opts.produtoId, series);
  }

  for (const numeroSerie of series) {
    const existente = await tx.unidadeSerie.findFirst({
      where: {
        produtoId: opts.produtoId,
        numeroSerie: { equals: numeroSerie, mode: "insensitive" },
      },
    });
    if (!existente) continue;
    if (
      opts.permitirReativarSaido &&
      existente.status === SERIE_STATUS.SAIDO
    ) {
      continue;
    }
    throw new AppError(
      400,
      `Número de série já cadastrado para este produto: ${existente.numeroSerie}`
    );
  }
  return series;
}

/**
 * Estorno: reverte status das séries da movimentação original e vincula ao estorno.
 */
export async function aplicarSeriesEstorno(
  tx: Tx,
  opts: {
    movimentacaoOriginalId: string;
    estornoId: string;
    /** ENTRADA original → series voltam a SAIDO ou são removidas se criadas na entrada */
    operacaoOriginal: "ENTRADA" | "SAIDA";
    filialId: string;
    clienteId?: string | null;
  }
) {
  const links = await tx.movimentacaoSerie.findMany({
    where: { movimentacaoId: opts.movimentacaoOriginalId },
    include: { unidadeSerie: true },
  });

  for (const link of links) {
    const u = link.unidadeSerie;

    if (opts.operacaoOriginal === "ENTRADA") {
      // Estorno de entrada: unidade sai do estoque. Se foi criada aqui e não tem
      // outro histórico, marca SAIDO; se era reativação de retorno, volta SAIDO.
      if (u.status !== SERIE_STATUS.EM_ESTOQUE || u.filialId !== opts.filialId) {
        throw new AppError(
          400,
          `Não é possível estornar: série ${u.numeroSerie} não está mais neste estoque`
        );
      }
      await tx.unidadeSerie.update({
        where: { id: u.id },
        data: {
          status: SERIE_STATUS.SAIDO,
          filialId: null,
          clienteId: opts.clienteId || null,
        },
      });
    } else {
      // Estorno de saída: volta ao estoque
      if (u.status !== SERIE_STATUS.SAIDO) {
        throw new AppError(
          400,
          `Não é possível estornar: série ${u.numeroSerie} não está mais saída`
        );
      }
      await tx.unidadeSerie.update({
        where: { id: u.id },
        data: {
          status: SERIE_STATUS.EM_ESTOQUE,
          filialId: opts.filialId,
          clienteId: null,
        },
      });
    }

    await tx.movimentacaoSerie.create({
      data: {
        movimentacaoId: opts.estornoId,
        unidadeSerieId: u.id,
      },
    });
  }
}

/** Transferência: valida e marca EM_TRANSITO (ou destino se imediato). */
export async function aplicarSeriesTransferenciaEnvio(
  tx: Tx,
  opts: {
    transferenciaItemId: string;
    movimentacaoEnviadaId: string;
    movimentacaoRecebidaId?: string | null;
    produtoId: string;
    origemFilialId: string;
    destinoFilialId: string;
    series: string[];
    quantidade: number;
    imediato: boolean;
    excludeTransferenciaId?: string | null;
  }
) {
  const series = normalizarSeries(opts.series);
  assertQuantidadeInteiraSerie(opts.quantidade, series.length);

  const reservadas = await seriesReservadasPendentes(tx, opts.produtoId);
  const emPendTransf = await seriesEmTransferenciaPendente(
    tx,
    opts.produtoId,
    opts.excludeTransferenciaId
  );

  for (const numeroSerie of series) {
    const key = numeroSerie.toUpperCase();
    if (reservadas.has(key) || emPendTransf.has(key)) {
      throw new AppError(
        400,
        `Série ${numeroSerie} está reservada em outro lançamento pendente`
      );
    }

    const unidade = await tx.unidadeSerie.findUnique({
      where: {
        uniq_produto_serie: {
          produtoId: opts.produtoId,
          numeroSerie,
        },
      },
    });
    if (
      !unidade ||
      unidade.status !== SERIE_STATUS.EM_ESTOQUE ||
      unidade.filialId !== opts.origemFilialId
    ) {
      throw new AppError(
        400,
        `Série ${numeroSerie} não está disponível na origem`
      );
    }

    if (opts.imediato) {
      await tx.unidadeSerie.update({
        where: { id: unidade.id },
        data: {
          status: SERIE_STATUS.EM_ESTOQUE,
          filialId: opts.destinoFilialId,
          clienteId: null,
        },
      });
    } else {
      await tx.unidadeSerie.update({
        where: { id: unidade.id },
        data: {
          status: SERIE_STATUS.EM_TRANSITO,
          filialId: null,
          clienteId: null,
        },
      });
    }

    await tx.transferenciaItemSerie.create({
      data: {
        transferenciaItemId: opts.transferenciaItemId,
        unidadeSerieId: unidade.id,
        enviado: true,
        recebido: opts.imediato ? true : null,
      },
    });

    await tx.movimentacaoSerie.create({
      data: {
        movimentacaoId: opts.movimentacaoEnviadaId,
        unidadeSerieId: unidade.id,
      },
    });

    if (opts.imediato && opts.movimentacaoRecebidaId) {
      await tx.movimentacaoSerie.create({
        data: {
          movimentacaoId: opts.movimentacaoRecebidaId,
          unidadeSerieId: unidade.id,
        },
      });
    }
  }
}

/**
 * Transferência com baixa pela árvore + pai com série:
 * as séries **nascem** no destino (não saem da origem).
 * imediato → EM_ESTOQUE no destino; senão → EM_TRANSITO até a conferência.
 */
export async function aplicarSeriesMontagemNascimento(
  tx: Tx,
  opts: {
    transferenciaItemId: string;
    movimentacaoEnviadaId: string;
    movimentacaoRecebidaId?: string | null;
    produtoId: string;
    destinoFilialId: string;
    series: string[];
    quantidade: number;
    imediato: boolean;
  }
) {
  const series = normalizarSeries(opts.series);
  assertQuantidadeInteiraSerie(opts.quantidade, series.length);
  await assertFormatoSeriesNascimento(tx, opts.produtoId, series);

  const reservadas = await seriesReservadasPendentes(tx, opts.produtoId);
  const emPendTransf = await seriesEmTransferenciaPendente(tx, opts.produtoId);

  for (const numeroSerie of series) {
    const key = numeroSerie.toUpperCase();
    if (reservadas.has(key) || emPendTransf.has(key)) {
      throw new AppError(
        400,
        `Série ${numeroSerie} está reservada em outro lançamento pendente`
      );
    }

    await assertSerieNaoExisteNoProduto(tx, opts.produtoId, numeroSerie);

    const created = await tx.unidadeSerie.create({
      data: {
        produtoId: opts.produtoId,
        numeroSerie,
        filialId: opts.imediato ? opts.destinoFilialId : null,
        status: opts.imediato
          ? SERIE_STATUS.EM_ESTOQUE
          : SERIE_STATUS.EM_TRANSITO,
      },
    });

    await tx.transferenciaItemSerie.create({
      data: {
        transferenciaItemId: opts.transferenciaItemId,
        unidadeSerieId: created.id,
        enviado: true,
        recebido: opts.imediato ? true : null,
      },
    });

    await tx.movimentacaoSerie.create({
      data: {
        movimentacaoId: opts.movimentacaoEnviadaId,
        unidadeSerieId: created.id,
      },
    });

    if (opts.imediato && opts.movimentacaoRecebidaId) {
      await tx.movimentacaoSerie.create({
        data: {
          movimentacaoId: opts.movimentacaoRecebidaId,
          unidadeSerieId: created.id,
        },
      });
    }
  }
}

/** Reserva séries em transferência PENDENTE_APROVACAO (sem mudar status da unidade). */
export async function reservarSeriesTransferenciaPendente(
  tx: Tx,
  opts: {
    transferenciaItemId: string;
    produtoId: string;
    origemFilialId: string;
    series: string[];
    quantidade: number;
  }
) {
  const series = normalizarSeries(opts.series);
  assertQuantidadeInteiraSerie(opts.quantidade, series.length);

  const reservadas = await seriesReservadasPendentes(tx, opts.produtoId);
  const emPendTransf = await seriesEmTransferenciaPendente(tx, opts.produtoId);

  for (const numeroSerie of series) {
    const key = numeroSerie.toUpperCase();
    if (reservadas.has(key) || emPendTransf.has(key)) {
      throw new AppError(
        400,
        `Série ${numeroSerie} está reservada em outro lançamento pendente`
      );
    }
    const unidade = await tx.unidadeSerie.findUnique({
      where: {
        uniq_produto_serie: {
          produtoId: opts.produtoId,
          numeroSerie,
        },
      },
    });
    if (
      !unidade ||
      unidade.status !== SERIE_STATUS.EM_ESTOQUE ||
      unidade.filialId !== opts.origemFilialId
    ) {
      throw new AppError(
        400,
        `Série ${numeroSerie} não está disponível na origem`
      );
    }
    await tx.transferenciaItemSerie.create({
      data: {
        transferenciaItemId: opts.transferenciaItemId,
        unidadeSerieId: unidade.id,
        enviado: true,
        recebido: null,
      },
    });
  }
}

/** Após aprovar transferência pendente: aplica EM_TRANSITO / destino a partir das reservas. */
export async function efetivarSeriesTransferenciaAposAprovacao(
  tx: Tx,
  opts: {
    transferenciaItemId: string;
    movimentacaoEnviadaId: string;
    movimentacaoRecebidaId?: string | null;
    destinoFilialId: string;
    imediato: boolean;
  }
) {
  const links = await tx.transferenciaItemSerie.findMany({
    where: { transferenciaItemId: opts.transferenciaItemId },
    include: { unidadeSerie: true },
  });

  for (const link of links) {
    const u = link.unidadeSerie;
    if (u.status !== SERIE_STATUS.EM_ESTOQUE) {
      throw new AppError(
        400,
        `Série ${u.numeroSerie} não está mais disponível na origem`
      );
    }

    if (opts.imediato) {
      await tx.unidadeSerie.update({
        where: { id: u.id },
        data: {
          status: SERIE_STATUS.EM_ESTOQUE,
          filialId: opts.destinoFilialId,
          clienteId: null,
        },
      });
      await tx.transferenciaItemSerie.update({
        where: { id: link.id },
        data: { recebido: true },
      });
    } else {
      await tx.unidadeSerie.update({
        where: { id: u.id },
        data: {
          status: SERIE_STATUS.EM_TRANSITO,
          filialId: null,
          clienteId: null,
        },
      });
    }

    await tx.movimentacaoSerie.create({
      data: {
        movimentacaoId: opts.movimentacaoEnviadaId,
        unidadeSerieId: u.id,
      },
    });
    if (opts.imediato && opts.movimentacaoRecebidaId) {
      await tx.movimentacaoSerie.create({
        data: {
          movimentacaoId: opts.movimentacaoRecebidaId,
          unidadeSerieId: u.id,
        },
      });
    }
  }
}

/**
 * Conferência: seriesRecebidas → destino EM_ESTOQUE;
 * demais → voltam à origem EM_ESTOQUE
 * (ou são descartadas se `nascerMontagem` — séries nascidas na carga).
 */
export async function aplicarSeriesConferencia(
  tx: Tx,
  opts: {
    transferenciaItemId: string;
    movimentacaoRecebidaId: string | null;
    destinoFilialId: string;
    origemFilialId: string;
    seriesRecebidas: string[];
    qtdRecebida: number;
    /** Séries criadas na montagem (não existiam na origem). */
    nascerMontagem?: boolean;
  }
) {
  const seriesRec = normalizarSeries(opts.seriesRecebidas);
  const recebidas = new Set(seriesRec.map((s) => s.toUpperCase()));
  if (recebidas.size !== opts.qtdRecebida) {
    throw new AppError(
      400,
      `Quantidade recebida (${opts.qtdRecebida}) deve coincidir com séries confirmadas (${recebidas.size})`
    );
  }

  const links = await tx.transferenciaItemSerie.findMany({
    where: { transferenciaItemId: opts.transferenciaItemId },
    include: { unidadeSerie: true },
  });

  if (links.length === 0 && opts.qtdRecebida > 0) {
    throw new AppError(400, "Item de transferência sem séries enviadas");
  }

  if (opts.nascerMontagem && opts.qtdRecebida !== links.length) {
    throw new AppError(
      400,
      "Transferência com baixa pela árvore e série exige conferência integral de todas as unidades nascidas"
    );
  }

  let qtdNaoRecebida = 0;

  for (const link of links) {
    const key = link.unidadeSerie.numeroSerie.toUpperCase();
    const chegou = recebidas.has(key);
    if (chegou) {
      recebidas.delete(key);
      if (link.unidadeSerie.status !== SERIE_STATUS.EM_TRANSITO) {
        throw new AppError(
          400,
          `Série ${link.unidadeSerie.numeroSerie} não está em trânsito`
        );
      }
      await tx.unidadeSerie.update({
        where: { id: link.unidadeSerieId },
        data: {
          status: SERIE_STATUS.EM_ESTOQUE,
          filialId: opts.destinoFilialId,
          clienteId: null,
        },
      });
      await tx.transferenciaItemSerie.update({
        where: { id: link.id },
        data: { recebido: true },
      });
      if (opts.movimentacaoRecebidaId) {
        await tx.movimentacaoSerie.create({
          data: {
            movimentacaoId: opts.movimentacaoRecebidaId,
            unidadeSerieId: link.unidadeSerieId,
          },
        });
      }
    } else if (opts.nascerMontagem) {
      // Não deveria ocorrer após a checagem integral; defesa em profundidade.
      qtdNaoRecebida += 1;
      await tx.movimentacaoSerie.deleteMany({
        where: { unidadeSerieId: link.unidadeSerieId },
      });
      await tx.transferenciaItemSerie.delete({ where: { id: link.id } });
      await tx.unidadeSerie.delete({ where: { id: link.unidadeSerieId } });
    } else {
      qtdNaoRecebida += 1;
      await tx.unidadeSerie.update({
        where: { id: link.unidadeSerieId },
        data: {
          status: SERIE_STATUS.EM_ESTOQUE,
          filialId: opts.origemFilialId,
          clienteId: null,
        },
      });
      await tx.transferenciaItemSerie.update({
        where: { id: link.id },
        data: { recebido: false },
      });
    }
  }

  if (recebidas.size > 0) {
    throw new AppError(
      400,
      `Série(s) confirmada(s) não estavam na carga: ${[...recebidas].join(", ")}`
    );
  }

  return { qtdNaoRecebida };
}

/** Inventário: cria N séries EM_ESTOQUE alinhadas ao saldo alvo (primeira vez). */
export async function aplicarSeriesInventario(
  tx: Tx,
  opts: {
    movimentacaoId: string;
    produtoId: string;
    filialId: string;
    series: string[];
    quantidade: number;
  }
) {
  return aplicarSeriesEntrada(tx, {
    ...opts,
    permitirReativarSaido: false,
  });
}

export async function listarSeriesDisponiveisFilial(
  db: Tx,
  produtoId: string,
  filialId: string
) {
  return db.unidadeSerie.findMany({
    where: {
      produtoId,
      filialId,
      status: SERIE_STATUS.EM_ESTOQUE,
    },
    orderBy: { numeroSerie: "asc" },
    select: {
      id: true,
      numeroSerie: true,
      status: true,
      filialId: true,
    },
  });
}
