import { Prisma, PrismaClient } from "@prisma/client";
import { isAbaixoMinimo, isAcimaMaximo } from "@teep/shared";
import { AppError } from "../middleware/error";

type Tx = Prisma.TransactionClient | PrismaClient;

export async function aplicarSaldo(
  tx: Tx,
  params: {
    produtoId: string;
    filialId: string;
    operacao: "ENTRADA" | "SAIDA";
    quantidade: Prisma.Decimal | number | string;
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
    if (novo.lt(qtd)) {
      throw new AppError(400, "Quantidade indisponível no estoque local");
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
