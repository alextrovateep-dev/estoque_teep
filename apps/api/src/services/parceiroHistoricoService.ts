import { TIPO_ESTORNO } from "@teep/shared";
import { prisma } from "../lib/prisma";
import type { Prisma } from "@prisma/client";

const STATUS_OK = "CONCLUIDO" as const;
const OPS = ["ENTRADA", "SAIDA"] as const;

export type ProdutoRelacionado = {
  produtoId: string;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidadeTotal: number;
  ultimaData: string;
  movimentos: number;
  /** true se o produto exige série */
  controlaSerie: boolean;
  /** Números de série envolvidos nesses movimentos (únicos, ordenados) */
  series: string[];
};

export type ParceiroRelacionado = {
  clienteId: string;
  nome: string;
  tipo: string;
  quantidadeTotal: number;
  ultimaData: string;
  movimentos: number;
};

export type ClienteRelacionamentos = {
  clienteId: string;
  /** ENTRADA de compra — o que compramos deles (fornecedor) */
  comprados: ProdutoRelacionado[];
  /** SAIDA de venda/entrega — o que vendemos/enviamos a eles (cliente) */
  vendidos: ProdutoRelacionado[];
};

export type ProdutoRelacionamentos = {
  produtoId: string;
  /** Quem nos vendeu (compra ENTRADA) */
  fornecedores: ParceiroRelacionado[];
  /** Para quem vendemos/enviamos (SAIDA) */
  clientes: ParceiroRelacionado[];
};

export type ClienteResumoItem = {
  clienteId: string;
  comprados: number;
  vendidos: number;
};

export type ProdutoResumoItem = {
  produtoId: string;
  fornecedores: number;
  clientes: number;
};

function num(v: { toString(): string } | number): number {
  return Number(v);
}

/**
 * Tipos que não representam compra nem venda/entrega comercial.
 * - Estorno: movimento inverso (também filtramos por estornoDeId)
 * - Devolução*: entrada de retorno do cliente ≠ compra de fornecedor
 */
export function isTipoHistoricoParceiroExcluido(nomeTipo: string): boolean {
  const n = nomeTipo.trim().toLowerCase();
  if (!n) return true;
  if (n === TIPO_ESTORNO.toLowerCase()) return true;
  if (n.includes("devolução") || n.includes("devolucao")) return true;
  return false;
}

/** Classifica operação para os buckets da feature (null = ignorar). */
export function bucketHistoricoParceiro(
  operacao: string,
  nomeTipo: string
): "comprados" | "vendidos" | null {
  if (isTipoHistoricoParceiroExcluido(nomeTipo)) return null;
  if (operacao === "ENTRADA") return "comprados";
  if (operacao === "SAIDA") return "vendidos";
  return null;
}

/** Movimentos válidos para o histórico parceiro↔produto. */
export function whereHistoricoParceiro(
  extra: Prisma.MovimentacaoWhereInput = {}
): Prisma.MovimentacaoWhereInput {
  return {
    status: STATUS_OK,
    estornoDeId: null,
    operacao: { in: [...OPS] },
    clienteId: { not: null },
    tipo: {
      AND: [
        { nome: { not: TIPO_ESTORNO } },
        {
          NOT: {
            OR: [
              { nome: { contains: "Devolução", mode: "insensitive" } },
              { nome: { contains: "Devolucao", mode: "insensitive" } },
            ],
          },
        },
      ],
    },
    ...extra,
  };
}

/** Produtos já comprados (ENTRADA) e já vendidos (SAIDA) para um cadastro. */
export async function relacionamentosDoCliente(
  clienteId: string
): Promise<ClienteRelacionamentos> {
  const rows = await prisma.movimentacao.findMany({
    where: whereHistoricoParceiro({ clienteId }),
    select: {
      operacao: true,
      quantidade: true,
      dataMovimento: true,
      tipo: { select: { nome: true } },
      produto: {
        select: {
          id: true,
          codigo: true,
          descricao: true,
          unidade: true,
          controlaSerie: true,
        },
      },
      series: {
        select: {
          unidadeSerie: { select: { numeroSerie: true } },
        },
      },
    },
    orderBy: { dataMovimento: "desc" },
  });

  const compradosRows = rows.filter(
    (r) => bucketHistoricoParceiro(r.operacao, r.tipo.nome) === "comprados"
  );
  const vendidosRows = rows.filter(
    (r) => bucketHistoricoParceiro(r.operacao, r.tipo.nome) === "vendidos"
  );

  return {
    clienteId,
    comprados: aggregateProdutos(compradosRows),
    vendidos: aggregateProdutos(vendidosRows),
  };
}

/** Fornecedores (compra) e clientes (venda/entrega) de um produto. */
export async function relacionamentosDoProduto(
  produtoId: string
): Promise<ProdutoRelacionamentos> {
  const rows = await prisma.movimentacao.findMany({
    where: whereHistoricoParceiro({ produtoId }),
    select: {
      operacao: true,
      quantidade: true,
      dataMovimento: true,
      tipo: { select: { nome: true } },
      cliente: {
        select: { id: true, nome: true, tipo: true },
      },
    },
    orderBy: { dataMovimento: "desc" },
  });

  const fornecedores = aggregateParceiros(
    rows.filter(
      (r) =>
        r.cliente &&
        bucketHistoricoParceiro(r.operacao, r.tipo.nome) === "comprados"
    )
  );
  const clientes = aggregateParceiros(
    rows.filter(
      (r) =>
        r.cliente &&
        bucketHistoricoParceiro(r.operacao, r.tipo.nome) === "vendidos"
    )
  );

  return { produtoId, fornecedores, clientes };
}

/** Contagens distintas de produto por cliente (ícone na lista). */
export async function resumoRelacionamentosClientes(): Promise<
  ClienteResumoItem[]
> {
  const rows = await prisma.movimentacao.findMany({
    where: whereHistoricoParceiro(),
    select: {
      clienteId: true,
      produtoId: true,
      operacao: true,
      tipo: { select: { nome: true } },
    },
    distinct: ["clienteId", "produtoId", "operacao"],
  });

  const map = new Map<string, { comprados: Set<string>; vendidos: Set<string> }>();
  for (const r of rows) {
    if (!r.clienteId) continue;
    const bucket = bucketHistoricoParceiro(r.operacao, r.tipo.nome);
    if (!bucket) continue;
    let entry = map.get(r.clienteId);
    if (!entry) {
      entry = { comprados: new Set(), vendidos: new Set() };
      map.set(r.clienteId, entry);
    }
    entry[bucket].add(r.produtoId);
  }

  return [...map.entries()].map(([clienteId, sets]) => ({
    clienteId,
    comprados: sets.comprados.size,
    vendidos: sets.vendidos.size,
  }));
}

/** Contagens distintas de parceiro por produto (ícone na lista). */
export async function resumoRelacionamentosProdutos(): Promise<
  ProdutoResumoItem[]
> {
  const rows = await prisma.movimentacao.findMany({
    where: whereHistoricoParceiro(),
    select: {
      produtoId: true,
      clienteId: true,
      operacao: true,
      tipo: { select: { nome: true } },
    },
    distinct: ["produtoId", "clienteId", "operacao"],
  });

  const map = new Map<
    string,
    { fornecedores: Set<string>; clientes: Set<string> }
  >();
  for (const r of rows) {
    if (!r.clienteId) continue;
    const bucket = bucketHistoricoParceiro(r.operacao, r.tipo.nome);
    if (!bucket) continue;
    let entry = map.get(r.produtoId);
    if (!entry) {
      entry = { fornecedores: new Set(), clientes: new Set() };
      map.set(r.produtoId, entry);
    }
    if (bucket === "comprados") entry.fornecedores.add(r.clienteId);
    else entry.clientes.add(r.clienteId);
  }

  return [...map.entries()].map(([produtoId, sets]) => ({
    produtoId,
    fornecedores: sets.fornecedores.size,
    clientes: sets.clientes.size,
  }));
}

function aggregateProdutos(
  rows: {
    quantidade: { toString(): string } | number;
    dataMovimento: Date;
    produto: {
      id: string;
      codigo: string;
      descricao: string;
      unidade: string;
      controlaSerie: boolean;
    };
    series?: Array<{ unidadeSerie: { numeroSerie: string } }>;
  }[]
): ProdutoRelacionado[] {
  const map = new Map<
    string,
    ProdutoRelacionado & { _ultima: Date; _series: Set<string> }
  >();
  for (const r of rows) {
    const id = r.produto.id;
    const prev = map.get(id);
    const seriesDoMov = (r.series || []).map((s) => s.unidadeSerie.numeroSerie);
    if (!prev) {
      map.set(id, {
        produtoId: id,
        codigo: r.produto.codigo,
        descricao: r.produto.descricao,
        unidade: r.produto.unidade,
        quantidadeTotal: num(r.quantidade),
        ultimaData: r.dataMovimento.toISOString(),
        movimentos: 1,
        controlaSerie: r.produto.controlaSerie,
        series: [],
        _ultima: r.dataMovimento,
        _series: new Set(seriesDoMov),
      });
    } else {
      prev.quantidadeTotal += num(r.quantidade);
      prev.movimentos += 1;
      if (r.produto.controlaSerie) prev.controlaSerie = true;
      for (const s of seriesDoMov) prev._series.add(s);
      if (r.dataMovimento > prev._ultima) {
        prev._ultima = r.dataMovimento;
        prev.ultimaData = r.dataMovimento.toISOString();
      }
    }
  }
  return [...map.values()]
    .map(({ _ultima: _, _series, ...rest }) => ({
      ...rest,
      series: [..._series].sort((a, b) =>
        a.localeCompare(b, "pt-BR", { sensitivity: "base" })
      ),
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR"));
}

function aggregateParceiros(
  rows: {
    quantidade: { toString(): string } | number;
    dataMovimento: Date;
    cliente: { id: string; nome: string; tipo: string } | null;
  }[]
): ParceiroRelacionado[] {
  const map = new Map<string, ParceiroRelacionado & { _ultima: Date }>();
  for (const r of rows) {
    if (!r.cliente) continue;
    const id = r.cliente.id;
    const prev = map.get(id);
    if (!prev) {
      map.set(id, {
        clienteId: id,
        nome: r.cliente.nome,
        tipo: r.cliente.tipo,
        quantidadeTotal: num(r.quantidade),
        ultimaData: r.dataMovimento.toISOString(),
        movimentos: 1,
        _ultima: r.dataMovimento,
      });
    } else {
      prev.quantidadeTotal += num(r.quantidade);
      prev.movimentos += 1;
      if (r.dataMovimento > prev._ultima) {
        prev._ultima = r.dataMovimento;
        prev.ultimaData = r.dataMovimento.toISOString();
      }
    }
  }
  return [...map.values()]
    .map(({ _ultima: _, ...rest }) => rest)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
