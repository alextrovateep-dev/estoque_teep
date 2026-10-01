import { Prisma } from "@prisma/client";

/** Saldo abaixo do mínimo do produto, respeitando o estoque escolhido no cadastro. */
export const sqlAbaixoMinimo = Prisma.sql`(
  p.estoque_minimo > 0
  AND e.saldo_atual <= p.estoque_minimo
  AND (
    p.estoque_minimo_filial_id IS NULL
    OR p.estoque_minimo_filial_id = e.filial_id
  )
)`;
