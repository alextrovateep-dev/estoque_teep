import { Prisma } from "@prisma/client";

/** Saldo abaixo do mínimo só nos estoques marcados no cadastro do produto. */
export const sqlAbaixoMinimo = Prisma.sql`(
  p.estoque_minimo > 0
  AND cardinality(p.estoque_minimo_filial_ids) > 0
  AND e.filial_id = ANY(p.estoque_minimo_filial_ids)
  AND e.saldo_atual <= p.estoque_minimo
)`;
