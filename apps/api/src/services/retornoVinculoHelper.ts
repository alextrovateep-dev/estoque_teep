import { Prisma } from "@prisma/client";

/** Status que ocupam qty da saída (impedem outro retorno sobre o mesmo saldo). */
const STATUS_OCUPA = ["CONCLUIDO", "PENDENTE"] as const;

type Db = Prisma.TransactionClient | typeof import("../lib/prisma").prisma;

async function sumQtyRetornos(
  db: Db,
  saidaId: string,
  status: string[],
  excludeRetornoId?: string | null
): Promise<number> {
  const rows = await db.movimentacao.findMany({
    where: {
      movimentacaoOrigemId: saidaId,
      status: { in: status },
      ...(excludeRetornoId ? { id: { not: excludeRetornoId } } : {}),
    },
    select: { quantidade: true },
  });
  return rows.reduce((s, r) => s + Number(r.quantidade), 0);
}

/**
 * Soma das quantidades de retornos que ainda ocupam a saída (CONCLUIDO+PENDENTE).
 * @param excludeRetornoId — ao aprovar/revalidar, ignora o próprio retorno
 */
export async function qtyRetornadaOcupada(
  db: Db,
  saidaId: string,
  excludeRetornoId?: string | null
): Promise<number> {
  return sumQtyRetornos(db, saidaId, [...STATUS_OCUPA], excludeRetornoId);
}

/** Só retornos CONCLUIDO — usado para cancelar/reabrir alertas (PENDENTE não “fecha” a saída). */
export async function qtyRetornadaConcluida(
  db: Db,
  saidaId: string,
  excludeRetornoId?: string | null
): Promise<number> {
  return sumQtyRetornos(db, saidaId, ["CONCLUIDO"], excludeRetornoId);
}

export async function qtyRestanteSaida(
  db: Db,
  saida: { id: string; quantidade: Prisma.Decimal | number },
  excludeRetornoId?: string | null
): Promise<number> {
  const ocupada = await qtyRetornadaOcupada(db, saida.id, excludeRetornoId);
  return Math.max(0, Number(saida.quantidade) - ocupada);
}

/** Qty ainda “fisicamente” em aberto para fins de alerta (ignora PENDENTE). */
export async function qtyRestanteParaAlertas(
  db: Db,
  saida: { id: string; quantidade: Prisma.Decimal | number },
  excludeRetornoId?: string | null
): Promise<number> {
  const concluida = await qtyRetornadaConcluida(
    db,
    saida.id,
    excludeRetornoId
  );
  return Math.max(0, Number(saida.quantidade) - concluida);
}

export async function saidaAindaAberta(
  db: Db,
  saida: { id: string; quantidade: Prisma.Decimal | number; status: string },
  excludeRetornoId?: string | null
): Promise<boolean> {
  if (saida.status !== "CONCLUIDO") return false;
  return (await qtyRestanteSaida(db, saida, excludeRetornoId)) > 1e-9;
}

/** Há retorno CONCLUIDO ou PENDENTE ligado à saída (bloqueia estorno da saída). */
export async function saidaTemRetornoAtivo(
  db: Db,
  saidaId: string
): Promise<boolean> {
  const n = await db.movimentacao.count({
    where: {
      movimentacaoOrigemId: saidaId,
      status: { in: [...STATUS_OCUPA] },
    },
  });
  return n > 0;
}

/**
 * Mapa saidaId → qty ocupada (CONCLUIDO+PENDENTE) em uma query.
 * Usado por listarSaidasAbertas para evitar N+1.
 */
export async function mapaQtyOcupadaPorSaidas(
  db: Db,
  saidaIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (saidaIds.length === 0) return map;
  const rows = await db.movimentacao.findMany({
    where: {
      movimentacaoOrigemId: { in: saidaIds },
      status: { in: [...STATUS_OCUPA] },
    },
    select: { movimentacaoOrigemId: true, quantidade: true },
  });
  for (const r of rows) {
    if (!r.movimentacaoOrigemId) continue;
    map.set(
      r.movimentacaoOrigemId,
      (map.get(r.movimentacaoOrigemId) || 0) + Number(r.quantidade)
    );
  }
  return map;
}
