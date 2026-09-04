import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/error";
import { purgeOrphanProdutoFiles } from "../lib/uploads";

export type BloqueioExclusaoProduto = {
  chave: string;
  motivo: string;
  quantidade: number;
};

type Tx = Prisma.TransactionClient | typeof prisma;

async function contarBloqueios(
  tx: Tx,
  produtoId: string
): Promise<BloqueioExclusaoProduto[]> {
  const [
    movs,
    bomFilho,
    bomPai,
    transf,
    series,
    rmaItens,
    rmaPecas,
    rmaOrc,
    pedidos,
    estoquePositivo,
  ] = await Promise.all([
    tx.movimentacao.count({ where: { produtoId } }),
    tx.produtoComponente.count({ where: { produtoFilhoId: produtoId } }),
    tx.produtoComponente.count({ where: { produtoPaiId: produtoId } }),
    tx.transferenciaItem.count({ where: { produtoId } }),
    tx.unidadeSerie.count({ where: { produtoId } }),
    tx.rmaItem.count({ where: { produtoId } }),
    tx.rmaManutencaoPeca.count({ where: { produtoId } }),
    tx.rmaOrcamentoLinha.count({ where: { produtoId } }),
    tx.pedidoVendaItem.count({ where: { produtoId } }),
    tx.estoque.count({
      where: { produtoId, saldoAtual: { not: 0 } },
    }),
  ]);

  const out: BloqueioExclusaoProduto[] = [];
  if (movs > 0)
    out.push({
      chave: "movimentacoes",
      motivo: "há movimentação(ões) / lançamento(s)",
      quantidade: movs,
    });
  if (bomFilho > 0)
    out.push({
      chave: "bom_filho",
      motivo: "é componente de outra árvore de produto",
      quantidade: bomFilho,
    });
  if (bomPai > 0)
    out.push({
      chave: "bom_pai",
      motivo: "é pai de uma árvore de produto (BOM)",
      quantidade: bomPai,
    });
  if (transf > 0)
    out.push({
      chave: "transferencias",
      motivo: "aparece em transferência(s)",
      quantidade: transf,
    });
  if (series > 0)
    out.push({
      chave: "series",
      motivo: "possui número(s) de série cadastrado(s)",
      quantidade: series,
    });
  if (rmaItens > 0)
    out.push({
      chave: "rma",
      motivo: "há item(ns) de RMA",
      quantidade: rmaItens,
    });
  if (rmaPecas > 0)
    out.push({
      chave: "rma_pecas",
      motivo: "usado como peça em manutenção RMA",
      quantidade: rmaPecas,
    });
  if (rmaOrc > 0)
    out.push({
      chave: "rma_orcamento",
      motivo: "aparece em orçamento RMA",
      quantidade: rmaOrc,
    });
  if (pedidos > 0)
    out.push({
      chave: "pedidos",
      motivo: "aparece em pedido(s) de venda",
      quantidade: pedidos,
    });
  if (estoquePositivo > 0)
    out.push({
      chave: "estoque",
      motivo: "ainda há saldo ≠ 0 em algum estoque",
      quantidade: estoquePositivo,
    });
  return out;
}

export async function avaliarExclusaoProduto(produtoId: string) {
  const produto = await prisma.produto.findUnique({
    where: { id: produtoId },
    select: { id: true, codigo: true, descricao: true },
  });
  if (!produto) throw new AppError(404, "Produto não encontrado");
  const bloqueios = await contarBloqueios(prisma, produtoId);
  return {
    produto,
    podeExcluir: bloqueios.length === 0,
    bloqueios,
  };
}

/** Remove produto se não houver vínculos de árvore, movimentação etc. */
export async function excluirProdutoSeLivre(produtoId: string) {
  const produto = await prisma.produto.findUnique({
    where: { id: produtoId },
    select: { id: true, codigo: true },
  });
  if (!produto) throw new AppError(404, "Produto não encontrado");

  await prisma.$transaction(async (tx) => {
    const bloqueios = await contarBloqueios(tx, produtoId);
    if (bloqueios.length > 0) {
      const detalhe = bloqueios
        .map((b) => `${b.motivo} (${b.quantidade})`)
        .join("; ");
      throw new AppError(
        409,
        `Não é possível excluir ${produto.codigo}: ${detalhe}`
      );
    }
    await tx.produto.delete({ where: { id: produtoId } });
  });

  purgeOrphanProdutoFiles(produtoId, []);

  return { id: produto.id, codigo: produto.codigo };
}
