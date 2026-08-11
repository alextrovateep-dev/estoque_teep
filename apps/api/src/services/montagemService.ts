import { TIPO_CONSUMO_MONTAGEM } from "@teep/shared";
import { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../middleware/error";
import {
  aplicarSaldo,
  qtyReservadaTransferenciaPendente,
} from "./estoqueService";

type Tx = Prisma.TransactionClient | PrismaClient;

export type BomLinha = {
  produtoFilhoId: string;
  quantidade: number;
  fantasma: boolean;
  filho: {
    id: string;
    codigo: string;
    descricao: string;
    controlaSerie: boolean;
    precoUnitario: Prisma.Decimal | number;
    ativo: boolean;
  };
};

/** Carrega BOM do acabado (1 nível). */
export async function carregarBomProduto(
  tx: Tx,
  produtoPaiId: string
): Promise<BomLinha[]> {
  const rows = await tx.produtoComponente.findMany({
    where: { produtoPaiId },
    include: {
      produtoFilho: {
        select: {
          id: true,
          codigo: true,
          descricao: true,
          controlaSerie: true,
          precoUnitario: true,
          ativo: true,
        },
      },
    },
    orderBy: { produtoFilho: { codigo: "asc" } },
  });
  return rows.map((r) => ({
    produtoFilhoId: r.produtoFilhoId,
    quantidade: Number(r.quantidade),
    fantasma: r.fantasma,
    filho: {
      id: r.produtoFilho.id,
      codigo: r.produtoFilho.codigo,
      descricao: r.produtoFilho.descricao,
      controlaSerie: r.produtoFilho.controlaSerie,
      precoUnitario: r.produtoFilho.precoUnitario,
      ativo: r.produtoFilho.ativo,
    },
  }));
}

/**
 * Valida a árvore e devolve linhas que baixam estoque na saída/transferência.
 * Fantasma = ignorado. Filho com série (não-fantasma) = erro no MVP.
 */
export function linhasConsumoMontagem(
  bom: BomLinha[],
  quantidadeMontada: number
): Array<{
  produtoId: string;
  codigo: string;
  quantidade: number;
  precoUnitario: number;
}> {
  if (!(quantidadeMontada > 0)) {
    throw new AppError(400, "Quantidade inválida para baixa pela árvore");
  }
  if (!bom.length) {
    throw new AppError(
      400,
      "Este produto não tem árvore de componentes. Cadastre a árvore no produto antes de lançar."
    );
  }

  const consumo: Array<{
    produtoId: string;
    codigo: string;
    quantidade: number;
    precoUnitario: number;
  }> = [];

  for (const linha of bom) {
    if (linha.fantasma) continue;
    if (!linha.filho.ativo) {
      throw new AppError(
        400,
        `Componente inativo na árvore: ${linha.filho.codigo}`
      );
    }
    if (linha.filho.controlaSerie) {
      throw new AppError(
        400,
        `O componente ${linha.filho.codigo} controla série — ainda não suportado na baixa pela árvore. Marque-o como fantasma ou use um produto sem série.`
      );
    }
    const qtd = linha.quantidade * quantidadeMontada;
    if (!(qtd > 0)) {
      throw new AppError(
        400,
        `Quantidade inválida para componente ${linha.filho.codigo}`
      );
    }
    consumo.push({
      produtoId: linha.produtoFilhoId,
      codigo: linha.filho.codigo,
      quantidade: qtd,
      precoUnitario: Number(linha.filho.precoUnitario),
    });
  }

  return consumo;
}

/** Garante saldo suficiente no estoque de origem da baixa (sem baixar). */
export async function assertSaldoComponentes(
  tx: Tx,
  opts: {
    filialComponentesId: string;
    consumo: Array<{ produtoId: string; codigo: string; quantidade: number }>;
    excludeTransferenciaId?: string | null;
  }
) {
  for (const c of opts.consumo) {
    const est = await tx.estoque.findUnique({
      where: {
        uniq_produto_filial: {
          produtoId: c.produtoId,
          filialId: opts.filialComponentesId,
        },
      },
    });
    const bruto = est ? Number(est.saldoAtual) : 0;
    const reservada = await qtyReservadaTransferenciaPendente(
      tx,
      c.produtoId,
      opts.filialComponentesId,
      opts.excludeTransferenciaId
    );
    const disponivel = bruto - reservada;
    if (disponivel + 1e-9 < c.quantidade) {
      throw new AppError(
        400,
        reservada > 0
          ? `Saldo insuficiente de ${c.codigo} na origem (precisa ${c.quantidade}, disponível ${disponivel}, reservado em transferência: ${reservada})`
          : `Saldo insuficiente de ${c.codigo} na origem (precisa ${c.quantidade}, tem ${bruto})`
      );
    }
  }
}

/**
 * Cria saídas do tipo sistema "Baixa de componente (árvore)" e baixa o saldo
 * dos não-fantasma no estoque de origem (mesma TX da SAIDA/TRANSFERÊNCIA).
 */
export async function aplicarConsumoMontagem(
  tx: Tx,
  opts: {
    montagemMovimentacaoId: string;
    usuarioId: string;
    filialComponentesId: string;
    quantidadeMontada: number;
    produtoPaiId: string;
    observacao?: string | null;
    excludeTransferenciaId?: string | null;
  }
) {
  let tipoConsumo = await tx.tipoMovimentacao.findUnique({
    where: { nome: TIPO_CONSUMO_MONTAGEM },
  });
  // Compat: bancos ainda com nome legado
  if (!tipoConsumo) {
    tipoConsumo = await tx.tipoMovimentacao.findUnique({
      where: { nome: "Consumo Montagem" },
    });
  }
  if (!tipoConsumo) {
    throw new AppError(
      500,
      `Tipo sistema "${TIPO_CONSUMO_MONTAGEM}" não configurado — rode o seed`
    );
  }

  const bom = await carregarBomProduto(tx, opts.produtoPaiId);
  const consumo = linhasConsumoMontagem(bom, opts.quantidadeMontada);

  if (!consumo.length) {
    // BOM só com fantasmas: não há componentes a baixar
    return { consumos: [] as string[] };
  }

  await assertSaldoComponentes(tx, {
    filialComponentesId: opts.filialComponentesId,
    consumo,
    excludeTransferenciaId: opts.excludeTransferenciaId,
  });

  const ids: string[] = [];
  for (const c of consumo) {
    await aplicarSaldo(tx, {
      produtoId: c.produtoId,
      filialId: opts.filialComponentesId,
      operacao: "SAIDA",
      quantidade: c.quantidade,
      excludeTransferenciaId: opts.excludeTransferenciaId,
    });

    const mov = await tx.movimentacao.create({
      data: {
        produtoId: c.produtoId,
        tipoId: tipoConsumo.id,
        usuarioId: opts.usuarioId,
        filialId: opts.filialComponentesId,
        quantidade: c.quantidade,
        precoUnitario: c.precoUnitario,
        operacao: "SAIDA",
        status: "CONCLUIDO",
        movimentacaoMontagemId: opts.montagemMovimentacaoId,
        observacao:
          opts.observacao ||
          `Baixa árvore ${opts.montagemMovimentacaoId.slice(0, 8)}`,
      },
    });
    ids.push(mov.id);
  }

  return { consumos: ids };
}
