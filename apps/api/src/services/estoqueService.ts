import { Prisma, PrismaClient } from "@prisma/client";
import { isAbaixoMinimo, isAcimaMaximo } from "@teep/shared";
import { AppError } from "../middleware/error";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Qty em cargas PENDENTE_APROVACAO que reservam saldo da origem
 * (ainda sem baixar o estoque).
 */
export async function qtyReservadaTransferenciaPendente(
  db: Tx,
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

export async function aplicarSaldo(
  tx: Tx,
  params: {
    produtoId: string;
    filialId: string;
    operacao: "ENTRADA" | "SAIDA";
    quantidade: Prisma.Decimal | number | string;
    /**
     * Ao baixar estoque de uma transferência que estava PENDENTE_APROVACAO,
     * exclui a própria carga da reserva (senão bloqueia a si mesma).
     */
    excludeTransferenciaId?: string | null;
  }
): Promise<{
  saldoAtual: Prisma.Decimal;
  abaixoMinimo: boolean;
  acimaMaximo: boolean;
}> {
  const qtd = new Prisma.Decimal(params.quantidade);
  if (qtd.lte(0)) throw new AppError(400, "Quantidade inválida");

  await tx.estoque.upsert({
    where: {
      uniq_produto_filial: {
        produtoId: params.produtoId,
        filialId: params.filialId,
      },
    },
    create: {
      produtoId: params.produtoId,
      filialId: params.filialId,
      saldoAtual: 0,
    },
    update: {},
  });

  const locked = await tx.$queryRaw<
    Array<{ id: string; saldo_atual: Prisma.Decimal }>
  >`
    SELECT id, saldo_atual
    FROM estoques
    WHERE produto_id = ${params.produtoId}::uuid
      AND filial_id = ${params.filialId}::uuid
    FOR UPDATE
  `;

  if (!locked[0]) throw new AppError(500, "Falha ao bloquear estoque");

  let novo = new Prisma.Decimal(locked[0].saldo_atual);
  if (params.operacao === "ENTRADA") {
    novo = novo.add(qtd);
  } else {
    const reservada = await qtyReservadaTransferenciaPendente(
      tx,
      params.produtoId,
      params.filialId,
      params.excludeTransferenciaId
    );
    const disponivel = novo.sub(new Prisma.Decimal(reservada));
    if (disponivel.lt(qtd)) {
      throw new AppError(
        400,
        reservada > 0
          ? `Quantidade indisponível no estoque local (disponível: ${disponivel}, reservado em transferência pendente: ${reservada})`
          : "Quantidade indisponível no estoque local"
      );
    }
    novo = novo.sub(qtd);
  }

  const updated = await tx.estoque.update({
    where: { id: locked[0].id },
    data: { saldoAtual: novo },
  });

  const produto = await tx.produto.findUniqueOrThrow({
    where: { id: params.produtoId },
  });

  return {
    saldoAtual: updated.saldoAtual,
    abaixoMinimo: isAbaixoMinimo(Number(updated.saldoAtual), produto.estoqueMinimo),
    acimaMaximo: isAcimaMaximo(Number(updated.saldoAtual), produto.estoqueMaximo),
  };
}

export async function obterSaldo(
  tx: Tx,
  produtoId: string,
  filialId: string
): Promise<Prisma.Decimal> {
  const e = await tx.estoque.findUnique({
    where: { uniq_produto_filial: { produtoId, filialId } },
  });
  return e?.saldoAtual ?? new Prisma.Decimal(0);
}
