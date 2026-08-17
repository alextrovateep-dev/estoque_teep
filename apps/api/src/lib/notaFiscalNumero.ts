import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { AppError } from "../middleware/error";
import {
  chaveNotaFiscalNumero,
  mensagemNotaFiscalDuplicada,
  normalizarNotaFiscalNumero,
  type NotaFiscalOperacao,
} from "./notaFiscalNumeroFormat";

export type { NotaFiscalOperacao };
export {
  chaveNotaFiscalNumero,
  mensagemNotaFiscalDuplicada,
  mesmaNotaFiscalNumero,
  normalizarNotaFiscalNumero,
} from "./notaFiscalNumeroFormat";

export type NotaFiscalExclude = {
  /** Linhas do mesmo lançamento multi-SKU (mesmo documento). */
  grupoLancamentoId?: string | null;
  rmaProcessoId?: string | null;
  rmaItemId?: string | null;
  transferenciaId?: string | null;
};

/** Coluna SQL confiável — nunca interpolar input do usuário. */
function sqlEqChaveNf(qualifiedColumn: string, chave: string) {
  return Prisma.sql`lower(regexp_replace(btrim(${Prisma.raw(qualifiedColumn)}), '[[:space:]]+', '', 'g')) = ${chave}`;
}

function sqlNfPreenchida(qualifiedColumn: string) {
  return Prisma.sql`${Prisma.raw(qualifiedColumn)} IS NOT NULL AND length(btrim(${Prisma.raw(qualifiedColumn)})) > 0`;
}

function sqlNotUuid(qualifiedColumn: string, id: string | null | undefined) {
  if (!id) return Prisma.sql``;
  return Prisma.sql`AND ${Prisma.raw(qualifiedColumn)} IS DISTINCT FROM ${id}::uuid`;
}

async function existeId(query: Prisma.Sql): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(query);
  return rows.length > 0;
}

/**
 * Impede o mesmo número de NF na mesma operação (entrada com entrada, etc.).
 * Cópias internas do RMA nas movimentações não entram na conta — o número
 * vive no processo. Estorno/rejeição/cancelamento liberam o número.
 * Compara pela mesma chave de `mesmaNotaFiscalNumero` (caixa e espaços).
 */
export async function assertNotaFiscalNumeroLivre(opts: {
  numero: string | null | undefined;
  operacao: NotaFiscalOperacao;
  exclude?: NotaFiscalExclude;
}): Promise<void> {
  const numero = normalizarNotaFiscalNumero(opts.numero);
  if (!numero) return;

  const emUso = await notaFiscalNumeroEmUso({
    numero,
    operacao: opts.operacao,
    exclude: opts.exclude,
  });
  if (emUso) {
    throw new AppError(409, mensagemNotaFiscalDuplicada(opts.operacao, numero));
  }
}

async function notaFiscalNumeroEmUso(opts: {
  numero: string;
  operacao: NotaFiscalOperacao;
  exclude?: NotaFiscalExclude;
}): Promise<boolean> {
  const { numero, operacao, exclude } = opts;
  const chave = chaveNotaFiscalNumero(numero);

  if (operacao === "ENTRADA") {
    const [mov, rma] = await Promise.all([
      existeId(Prisma.sql`
        SELECT m.id
        FROM movimentacoes m
        INNER JOIN tipos_movimentacao t ON t.id = m.tipo_id
        WHERE ${sqlNfPreenchida("m.nota_fiscal_numero")}
          AND ${sqlEqChaveNf("m.nota_fiscal_numero", chave)}
          AND m.operacao = 'ENTRADA'
          AND m.status NOT IN ('ESTORNADO', 'REJEITADO')
          AND m.estorno_de_id IS NULL
          AND t.rma_entrada_estoque = false
          ${sqlNotUuid("m.grupo_lancamento_id", exclude?.grupoLancamentoId)}
        LIMIT 1
      `),
      existeId(Prisma.sql`
        SELECT p.id
        FROM rma_processos p
        WHERE ${sqlNfPreenchida("p.nf_entrada_numero")}
          AND ${sqlEqChaveNf("p.nf_entrada_numero", chave)}
          AND p.status <> 'CANCELADO'
          ${sqlNotUuid("p.id", exclude?.rmaProcessoId)}
        LIMIT 1
      `),
    ]);
    return mov || rma;
  }

  if (operacao === "SAIDA") {
    const [mov, rma] = await Promise.all([
      existeId(Prisma.sql`
        SELECT m.id
        FROM movimentacoes m
        INNER JOIN tipos_movimentacao t ON t.id = m.tipo_id
        WHERE ${sqlNfPreenchida("m.nota_fiscal_numero")}
          AND ${sqlEqChaveNf("m.nota_fiscal_numero", chave)}
          AND m.operacao = 'SAIDA'
          AND m.status NOT IN ('ESTORNADO', 'REJEITADO')
          AND m.estorno_de_id IS NULL
          AND t.rma_saida_cliente = false
          ${sqlNotUuid("m.grupo_lancamento_id", exclude?.grupoLancamentoId)}
        LIMIT 1
      `),
      existeId(Prisma.sql`
        SELECT p.id
        FROM rma_processos p
        WHERE ${sqlNfPreenchida("p.nf_saida_numero")}
          AND ${sqlEqChaveNf("p.nf_saida_numero", chave)}
          AND p.status <> 'CANCELADO'
          ${sqlNotUuid("p.id", exclude?.rmaProcessoId)}
        LIMIT 1
      `),
    ]);
    return mov || rma;
  }

  if (operacao === "TRANSFERENCIA") {
    return existeId(Prisma.sql`
      SELECT t.id
      FROM transferencias t
      WHERE ${sqlNfPreenchida("t.nota_fiscal_numero")}
        AND ${sqlEqChaveNf("t.nota_fiscal_numero", chave)}
        AND t.status NOT IN ('CANCELADO', 'REJEITADO')
        ${sqlNotUuid("t.id", exclude?.transferenciaId)}
      LIMIT 1
    `);
  }

  const [item, proc] = await Promise.all([
    existeId(Prisma.sql`
      SELECT i.id
      FROM rma_itens i
      WHERE ${sqlNfPreenchida("i.nf_cobranca_numero")}
        AND ${sqlEqChaveNf("i.nf_cobranca_numero", chave)}
        AND i.status <> 'CANCELADO'
        ${sqlNotUuid("i.id", exclude?.rmaItemId)}
        ${sqlNotUuid("i.processo_id", exclude?.rmaProcessoId)}
      LIMIT 1
    `),
    existeId(Prisma.sql`
      SELECT p.id
      FROM rma_processos p
      WHERE ${sqlNfPreenchida("p.nf_cobranca_numero")}
        AND ${sqlEqChaveNf("p.nf_cobranca_numero", chave)}
        AND p.status <> 'CANCELADO'
        ${sqlNotUuid("p.id", exclude?.rmaProcessoId)}
      LIMIT 1
    `),
  ]);
  return item || proc;
}
