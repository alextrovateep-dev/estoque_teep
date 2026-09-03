import { Prisma } from "@prisma/client";

/**
 * Calcula o custo real de um produto explodindo recursivamente sua BOM.
 *
 * - Se o produto tem BOM: custo = soma(qtd × calcularCustoBom(filho))
 * - Se não tem BOM: retorna null (caller usa precoUnitario como fallback)
 * - Itens fantasma não entram no custo
 * - Proteção contra ciclos via `visitados`
 */
export async function calcularCustoBom(
  produtoId: string,
  tx: Prisma.TransactionClient,
  visitados: Set<string> = new Set()
): Promise<number | null> {
  if (visitados.has(produtoId)) return null; // ciclo — fallback para precoUnitario

  const bom = await tx.produtoComponente.findMany({
    where: { produtoPaiId: produtoId },
    select: {
      quantidade: true,
      fantasma: true,
      produtoFilho: { select: { id: true, precoUnitario: true } },
    },
  });

  if (!bom.length) return null;

  const reais = bom.filter((i) => !i.fantasma);
  if (!reais.length) return null; // BOM só com fantasmas → fallback para precoUnitario

  visitados.add(produtoId);
  let total = 0;

  for (const item of reais) {
    const qtd = Number(item.quantidade);
    const filho = item.produtoFilho;
    const custoBomFilho = await calcularCustoBom(filho.id, tx, visitados);
    const custoUnitario =
      custoBomFilho !== null ? custoBomFilho : Number(filho.precoUnitario);
    total += qtd * custoUnitario;
  }

  visitados.delete(produtoId);
  return total;
}
