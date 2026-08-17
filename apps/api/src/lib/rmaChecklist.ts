import { prisma } from "./prisma";
import type { RmaChecklistTipo } from "@teep/shared";

/** Template ativo com ao menos um item — mesmo critério do recebimento. */
export async function produtoTemChecklistAtivo(
  produtoId: string,
  tipo: RmaChecklistTipo
): Promise<boolean> {
  const t = await prisma.rmaChecklistTemplate.findFirst({
    where: {
      produtoId,
      tipo,
      ativo: true,
      itens: { some: {} },
    },
    select: { id: true },
  });
  return Boolean(t);
}
