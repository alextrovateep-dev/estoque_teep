import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/error";

export type BloqueioExclusaoCliente = {
  chave: string;
  motivo: string;
  quantidade: number;
};

type Tx = Prisma.TransactionClient | typeof prisma;

async function contarBloqueios(
  tx: Tx,
  clienteId: string
): Promise<BloqueioExclusaoCliente[]> {
  const [movs, rmas, series, pedidos] = await Promise.all([
    tx.movimentacao.count({ where: { clienteId } }),
    tx.rmaProcesso.count({ where: { clienteId } }),
    tx.unidadeSerie.count({ where: { clienteId } }),
    tx.pedidoVenda.count({ where: { clienteId } }),
  ]);

  const out: BloqueioExclusaoCliente[] = [];
  if (movs > 0)
    out.push({
      chave: "movimentacoes",
      motivo: "há movimentação(ões) / lançamento(s)",
      quantidade: movs,
    });
  if (rmas > 0)
    out.push({
      chave: "rma",
      motivo: "há processo(s) de RMA",
      quantidade: rmas,
    });
  if (series > 0)
    out.push({
      chave: "series",
      motivo: "há número(s) de série vinculado(s)",
      quantidade: series,
    });
  if (pedidos > 0)
    out.push({
      chave: "pedidos",
      motivo: "há pedido(s) de venda",
      quantidade: pedidos,
    });
  return out;
}

export async function avaliarExclusaoCliente(clienteId: string) {
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { id: true, nome: true, tipo: true, documento: true },
  });
  if (!cliente) throw new AppError(404, "Cliente/fornecedor não encontrado");
  const bloqueios = await contarBloqueios(prisma, clienteId);
  return {
    cliente,
    podeExcluir: bloqueios.length === 0,
    bloqueios,
  };
}

/** Remove cliente/fornecedor se não houver vínculos de histórico. */
export async function excluirClienteSeLivre(clienteId: string) {
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { id: true, nome: true, tipo: true },
  });
  if (!cliente) throw new AppError(404, "Cliente/fornecedor não encontrado");

  await prisma.$transaction(async (tx) => {
    const bloqueios = await contarBloqueios(tx, clienteId);
    if (bloqueios.length > 0) {
      const detalhe = bloqueios
        .map((b) => `${b.motivo} (${b.quantidade})`)
        .join("; ");
      throw new AppError(
        409,
        `Não é possível excluir ${cliente.nome}: ${detalhe}`
      );
    }
    await tx.cliente.delete({ where: { id: clienteId } });
  });

  return { id: cliente.id, nome: cliente.nome, tipo: cliente.tipo };
}
