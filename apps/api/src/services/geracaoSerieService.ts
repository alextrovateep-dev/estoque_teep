import {
  FORMATO_SERIE_PADRAO,
  MAX_SERIES_POR_LOTE,
  TAMANHO_SEQ_PADRAO,
  formatoComTamanho,
  gerarSequenciaSeries,
} from "@teep/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/error";

type Tx = Prisma.TransactionClient;

function cfgDefaults() {
  return {
    formato: FORMATO_SERIE_PADRAO,
    geracaoAutomatica: true,
    tamanhoSequencial: TAMANHO_SEQ_PADRAO,
    prefixoFixo: null as string | null,
    sufixoFixo: null as string | null,
    reiniciarAnual: true,
  };
}

/**
 * Reserva o próximo bloco de sequenciais do produto/ano e devolve os números.
 * Não cria UnidadeSerie — o lançamento de entrada é quem registra no estoque.
 */
export async function alocarSeriesProduto(opts: {
  produtoId: string;
  quantidade: number;
  usuarioId: string;
}) {
  const qtd = opts.quantidade;
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > MAX_SERIES_POR_LOTE) {
    throw new AppError(
      400,
      `Quantidade deve ser inteiro entre 1 e ${MAX_SERIES_POR_LOTE}`
    );
  }

  const produto = await prisma.produto.findFirst({
    where: { id: opts.produtoId, ativo: true },
    include: { configuracaoSerie: true },
  });
  if (!produto) throw new AppError(400, "Produto inválido");
  if (!produto.controlaSerie) {
    throw new AppError(
      400,
      `Produto ${produto.codigo} não controla número de série`
    );
  }

  const cfg = produto.configuracaoSerie || cfgDefaults();
  if (!cfg.geracaoAutomatica) {
    throw new AppError(
      400,
      `Geração automática desativada para o produto ${produto.codigo}. Informe as séries manualmente ou ative no cadastro.`
    );
  }

  const anoCheio = new Date().getFullYear();
  /** Contador: ano corrente, ou 0 se não reinicia anualmente */
  const anoContador = cfg.reiniciarAnual ? anoCheio : 0;
  const ano2 = anoCheio % 100;
  const tamanho = Math.min(
    6,
    Math.max(3, cfg.tamanhoSequencial || TAMANHO_SEQ_PADRAO)
  );
  const formato = formatoComTamanho(
    cfg.formato || FORMATO_SERIE_PADRAO,
    tamanho
  );

  const result = await prisma.$transaction(async (tx) => {
    await tx.contadorSerie.upsert({
      where: {
        produtoId_ano: { produtoId: produto.id, ano: anoContador },
      },
      create: { produtoId: produto.id, ano: anoContador, sequencial: 0 },
      update: {},
    });

    await tx.$queryRaw`
      SELECT id FROM contador_series
      WHERE produto_id = ${produto.id}::uuid AND ano = ${anoContador}
      FOR UPDATE
    `;
    const locked = await tx.contadorSerie.findUniqueOrThrow({
      where: {
        produtoId_ano: { produtoId: produto.id, ano: anoContador },
      },
    });

    const maxSeq = 10 ** tamanho - 1;
    if (locked.sequencial + qtd > maxSeq) {
      throw new AppError(
        400,
        `Sequencial do produto ${produto.codigo} esgotaria o limite de ${tamanho} dígitos${
          cfg.reiniciarAnual ? " neste ano" : ""
        } (máx. ${maxSeq}). Ajuste o contador ou o tamanho.`
      );
    }

    const sequencialInicial = locked.sequencial + 1;
    const sequencialFinal = locked.sequencial + qtd;
    const series = gerarSequenciaSeries({
      codigoProduto: produto.codigo,
      ano2,
      sequencialInicial,
      quantidade: qtd,
      tamanhoSequencial: tamanho,
      formato,
      prefixoFixo: cfg.prefixoFixo,
      sufixoFixo: cfg.sufixoFixo,
    });

    const existentes = await tx.unidadeSerie.findMany({
      where: {
        produtoId: produto.id,
        numeroSerie: { in: series },
      },
      select: { numeroSerie: true },
    });
    if (existentes.length > 0) {
      throw new AppError(
        409,
        `Série(s) já cadastrada(s): ${existentes
          .map((e) => e.numeroSerie)
          .slice(0, 5)
          .join(", ")}. Ajuste o contador ou use outro lote.`
      );
    }

    await tx.contadorSerie.update({
      where: { id: locked.id },
      data: { sequencial: sequencialFinal },
    });

    const alocacao = await tx.serieAlocacao.create({
      data: {
        produtoId: produto.id,
        usuarioId: opts.usuarioId,
        ano: anoContador,
        sequencialInicial,
        sequencialFinal,
        series,
        status: "PENDENTE",
      },
    });

    return {
      alocacaoId: alocacao.id,
      series,
      ano: anoContador,
      anoCalendario: anoCheio,
      sequencialInicial,
      sequencialFinal,
      formato,
      produto: {
        id: produto.id,
        codigo: produto.codigo,
        descricao: produto.descricao,
      },
    };
  });

  return result;
}

/**
 * Desfaz alocação PENDENTE: reverte o contador só se ainda for o topo
 * e nenhuma UnidadeSerie foi criada com esses números.
 */
export async function desfazerAlocacaoSerie(opts: {
  alocacaoId: string;
  usuarioId: string;
  perfil: string;
}) {
  return prisma.$transaction(async (tx) => {
    // Trava a alocação primeiro (serializa com a entrada)
    await tx.$queryRaw`
      SELECT id FROM serie_alocacoes
      WHERE id = ${opts.alocacaoId}::uuid
      FOR UPDATE
    `;
    const aloc = await tx.serieAlocacao.findUnique({
      where: { id: opts.alocacaoId },
    });
    if (!aloc) throw new AppError(404, "Alocação não encontrada");
    if (aloc.status !== "PENDENTE") {
      throw new AppError(
        400,
        `Alocação já está ${aloc.status.toLowerCase()} — não pode desfazer`
      );
    }
    if (
      opts.perfil === "OPERADOR" &&
      aloc.usuarioId !== opts.usuarioId
    ) {
      throw new AppError(403, "Só é possível desfazer a própria alocação");
    }

    const series = Array.isArray(aloc.series)
      ? (aloc.series as string[])
      : [];

    await tx.$queryRaw`
      SELECT id FROM contador_series
      WHERE produto_id = ${aloc.produtoId}::uuid AND ano = ${aloc.ano}
      FOR UPDATE
    `;
    const contador = await tx.contadorSerie.findUnique({
      where: {
        produtoId_ano: { produtoId: aloc.produtoId, ano: aloc.ano },
      },
    });
    if (!contador) {
      throw new AppError(400, "Contador da alocação não encontrado");
    }
    if (contador.sequencial !== aloc.sequencialFinal) {
      throw new AppError(
        400,
        "Há alocação mais recente neste produto. Desfaça a última geração primeiro."
      );
    }

    // Revalida unidades DEPOIS dos locks (evita corrida com o lançamento)
    if (series.length) {
      const existentes = await tx.unidadeSerie.findMany({
        where: {
          produtoId: aloc.produtoId,
          numeroSerie: { in: series },
        },
        select: { numeroSerie: true },
      });
      if (existentes.length > 0) {
        throw new AppError(
          400,
          `Não é possível desfazer: série(s) já entraram no estoque (${existentes
            .map((e) => e.numeroSerie)
            .slice(0, 3)
            .join(", ")})`
        );
      }
    }

    await tx.contadorSerie.update({
      where: { id: contador.id },
      data: { sequencial: aloc.sequencialInicial - 1 },
    });

    const updated = await tx.serieAlocacao.update({
      where: { id: aloc.id },
      data: { status: "CANCELADA" },
    });

    return {
      alocacaoId: updated.id,
      status: updated.status,
      series,
      sequencialAtual: aloc.sequencialInicial - 1,
    };
  });
}

function seriesList(raw: unknown): string[] {
  return Array.isArray(raw) ? (raw as string[]).map(String) : [];
}

function upperSet(series: string[]): Set<string> {
  return new Set(series.map((s) => s.trim().toUpperCase()).filter(Boolean));
}

/**
 * Antes de criar UnidadeSerie na entrada:
 * - trava alocações PENDENTE que se sobrepõem
 * - rejeita lote parcial (tem que lançar todas ou desfazer)
 * - rejeita séries de geração já desfeita (evita contador preso na corrida)
 * Devolve ids das alocações a confirmar após criar as unidades.
 */
export async function prepararEntradaComAlocacoes(
  tx: Tx,
  opts: { produtoId: string; series: string[] }
): Promise<string[]> {
  const launched = opts.series.map((s) => s.trim()).filter(Boolean);
  if (!launched.length) return [];
  const launchedSet = upperSet(launched);

  const candidatas = await tx.serieAlocacao.findMany({
    where: {
      produtoId: opts.produtoId,
      status: { in: ["PENDENTE", "CANCELADA"] },
    },
    orderBy: { criadoEm: "desc" },
    take: 30,
  });

  const aConfirmar: string[] = [];

  for (const aloc of candidatas) {
    const alocSeries = seriesList(aloc.series);
    if (!alocSeries.length) continue;
    const alocSet = upperSet(alocSeries);
    const overlap = [...alocSet].some((s) => launchedSet.has(s));
    if (!overlap) continue;

    if (aloc.status === "PENDENTE") {
      await tx.$queryRaw`
        SELECT id FROM serie_alocacoes
        WHERE id = ${aloc.id}::uuid
        FOR UPDATE
      `;
      const locked = await tx.serieAlocacao.findUniqueOrThrow({
        where: { id: aloc.id },
      });
      if (locked.status !== "PENDENTE") {
        // Desfeita enquanto esperávamos o lock
        if (locked.status === "CANCELADA") {
          throw new AppError(
            409,
            "A geração automática foi desfeita. Gere as séries novamente antes de confirmar."
          );
        }
        continue;
      }

      const lockedSeries = seriesList(locked.series);
      const lockedSet = upperSet(lockedSeries);
      const allCovered = [...lockedSet].every((s) => launchedSet.has(s));
      const anyLaunchedFromAloc = [...launchedSet].some((s) =>
        lockedSet.has(s)
      );
      if (anyLaunchedFromAloc && !allCovered) {
        throw new AppError(
          400,
          "Lance todas as séries geradas ou desfaça a geração antes de confirmar (lote parcial não é permitido)."
        );
      }
      if (allCovered) aConfirmar.push(locked.id);
    } else if (aloc.status === "CANCELADA") {
      // Já há PENDENTE mais nova cobrindo o lançamento (ex.: desfez e gerou de novo)
      if (aConfirmar.length) continue;

      const fromCancelled = [...launchedSet].filter((s) => alocSet.has(s));
      if (!fromCancelled.length) continue;

      const existentes = await tx.unidadeSerie.count({
        where: {
          produtoId: opts.produtoId,
          numeroSerie: {
            in: launched.filter((s) =>
              alocSet.has(s.trim().toUpperCase())
            ),
          },
        },
      });
      if (existentes === 0) {
        throw new AppError(
          409,
          "Esta geração foi desfeita. Gere as séries novamente antes de confirmar."
        );
      }
    }
  }

  return aConfirmar;
}

/** Marca alocações já validadas como CONFIRMADA (lote inteiro coberto). */
export async function confirmarAlocacoesPorIds(
  tx: Tx,
  alocacaoIds: string[]
) {
  if (!alocacaoIds.length) return;
  await tx.serieAlocacao.updateMany({
    where: { id: { in: alocacaoIds }, status: "PENDENTE" },
    data: { status: "CONFIRMADA" },
  });
}

export async function consultarContadorSerie(produtoId: string) {
  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, ativo: true },
    select: {
      id: true,
      codigo: true,
      controlaSerie: true,
      configuracaoSerie: true,
    },
  });
  if (!produto) throw new AppError(404, "Produto não encontrado");
  const reiniciar = produto.configuracaoSerie?.reiniciarAnual ?? true;
  const anoCalendario = new Date().getFullYear();
  const ano = reiniciar ? anoCalendario : 0;
  const contador = await prisma.contadorSerie.findUnique({
    where: { produtoId_ano: { produtoId, ano } },
  });
  return {
    produtoId,
    codigo: produto.codigo,
    ano,
    anoCalendario,
    sequencialAtual: contador?.sequencial ?? 0,
    proximo: (contador?.sequencial ?? 0) + 1,
    configuracao: produto.configuracaoSerie || cfgDefaults(),
  };
}

export async function upsertConfiguracaoSerie(
  tx: Tx,
  produtoId: string,
  data: {
    formato?: string;
    geracaoAutomatica?: boolean;
    tamanhoSequencial?: number;
    prefixoFixo?: string | null;
    sufixoFixo?: string | null;
    reiniciarAnual?: boolean;
  } | null
) {
  if (data === null) {
    await tx.configuracaoSerie.deleteMany({ where: { produtoId } });
    return null;
  }
  const tamanho = Math.min(
    6,
    Math.max(3, data.tamanhoSequencial ?? TAMANHO_SEQ_PADRAO)
  );
  const formato = formatoComTamanho(
    data.formato || FORMATO_SERIE_PADRAO,
    tamanho
  );
  return tx.configuracaoSerie.upsert({
    where: { produtoId },
    create: {
      produtoId,
      formato,
      geracaoAutomatica: data.geracaoAutomatica ?? true,
      tamanhoSequencial: tamanho,
      prefixoFixo: data.prefixoFixo ?? null,
      sufixoFixo: data.sufixoFixo ?? null,
      reiniciarAnual: data.reiniciarAnual ?? true,
    },
    update: {
      formato,
      geracaoAutomatica: data.geracaoAutomatica ?? true,
      tamanhoSequencial: tamanho,
      prefixoFixo: data.prefixoFixo ?? null,
      sufixoFixo: data.sufixoFixo ?? null,
      reiniciarAnual: data.reiniciarAnual ?? true,
    },
  });
}
