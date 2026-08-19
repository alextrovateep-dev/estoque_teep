import { randomUUID } from "crypto";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { operadorFilialIds } from "../lib/filialScope";
import { agruparItensSaidaPedido } from "../lib/pedidoSeparacaoItens";
import { criarMovimentacao } from "./movimentacaoService";
import { notificarPedidoSeparado } from "./alertaService";

const pedidoInclude = {
  filialAcabado: { select: { id: true, nome: true, sigla: true } },
  separadoPor: { select: { id: true, nome: true, email: true } },
  itens: {
    include: {
      produto: {
        select: {
          id: true,
          codigo: true,
          descricao: true,
          controlaSerie: true,
        },
      },
    },
    orderBy: { codigoProprio: "asc" as const },
  },
  destinatarios: {
    include: { usuario: { select: { id: true, nome: true, email: true } } },
  },
};

function qtyEq(a: number, b: number) {
  return Math.abs(a - b) < 1e-6;
}

export async function listarPedidos(status?: string) {
  const st = status === "SEPARADO" ? "SEPARADO" : "ABERTO";
  return prisma.pedidoVenda.findMany({
    where: { status: st },
    include: {
      filialAcabado: { select: { id: true, sigla: true, nome: true } },
      _count: { select: { itens: true } },
    },
    orderBy: { dtVenda: "desc" },
    take: 200,
  });
}

export async function obterPedido(id: string) {
  const row = await prisma.pedidoVenda.findUnique({
    where: { id },
    include: pedidoInclude,
  });
  if (!row) throw new AppError(404, "Pedido não encontrado");
  return row;
}

export async function listarEstoquesAcabados(user: AuthUser) {
  const where: {
    ativo: boolean;
    estoqueAcabados: boolean;
    id?: { in: string[] };
  } = { ativo: true, estoqueAcabados: true };
  if (user.perfil === "OPERADOR") {
    const ids = operadorFilialIds(user);
    where.id = { in: ids };
  }
  return prisma.filial.findMany({
    where,
    select: { id: true, nome: true, sigla: true },
    orderBy: { sigla: "asc" },
  });
}

export async function listarUsuariosDestinatariosPedido() {
  return prisma.usuario.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, email: true },
    orderBy: { nome: "asc" },
  });
}

export async function tipoSaidaPedidoAtivo() {
  return prisma.tipoMovimentacao.findFirst({
    where: { saidaPedidoVenda: true, ativo: true, operacao: "SAIDA" },
  });
}

export async function syncPedidoAposGrupoLancamento(grupoId: string) {
  const pedido = await prisma.pedidoVenda.findFirst({
    where: { grupoLancamentoId: grupoId },
    include: {
      destinatarios: true,
      filialAcabado: { select: { sigla: true } },
    },
  });
  if (!pedido || pedido.status === "SEPARADO") return;

  const movs = await prisma.movimentacao.findMany({
    where: { grupoLancamentoId: grupoId },
    select: { status: true },
  });
  if (movs.length === 0) return;

  if (movs.some((m) => m.status === "REJEITADO")) {
    await prisma.pedidoVenda.update({
      where: { id: pedido.id },
      data: { grupoLancamentoId: null, filialAcabadoId: null },
    });
    await prisma.pedidoVendaDestinatario.deleteMany({
      where: { pedidoId: pedido.id },
    });
    return;
  }

  if (movs.every((m) => m.status === "CONCLUIDO")) {
    await prisma.pedidoVenda.update({
      where: { id: pedido.id },
      data: {
        status: "SEPARADO",
        separadoEm: new Date(),
      },
    });
    const destIds = pedido.destinatarios.map((d) => d.usuarioId);
    if (destIds.length) {
      notificarPedidoSeparado({
        pedidoId: pedido.id,
        egestorCodigo: pedido.egestorCodigo,
        clienteNome: pedido.nomeContato,
        filialSigla: pedido.filialAcabado?.sigla || "—",
        destinatarioIds: destIds,
      });
    }
  }
}

export async function separarPedido(
  user: AuthUser,
  pedidoId: string,
  input: {
    filialId: string;
    destinatarioIds: string[];
    itens: Array<{ id: string; quantidade: number; series?: string[] }>;
  }
) {
  const pedido = await prisma.pedidoVenda.findUnique({
    where: { id: pedidoId },
    include: { itens: { include: { produto: true } } },
  });
  if (!pedido) throw new AppError(404, "Pedido não encontrado");
  if (pedido.status !== "ABERTO") {
    throw new AppError(400, "Pedido já separado");
  }

  if (pedido.grupoLancamentoId) {
    const jaSeparado = await retomarSeparacaoExistente(
      pedido.id,
      pedido.grupoLancamentoId
    );
    if (jaSeparado) return jaSeparado;
  }

  const tipo = await tipoSaidaPedidoAtivo();
  if (!tipo) {
    throw new AppError(
      400,
      "Cadastre um tipo de saída com a flag «Saída de pedido de venda»"
    );
  }

  const filial = await prisma.filial.findFirst({
    where: { id: input.filialId, ativo: true, estoqueAcabados: true },
  });
  if (!filial) {
    throw new AppError(400, "Escolha um estoque de acabados ativo");
  }
  if (user.perfil === "OPERADOR") {
    const ids = operadorFilialIds(user);
    if (!ids.includes(filial.id)) {
      throw new AppError(403, "Operador sem acesso a este estoque de acabados");
    }
  }

  const destIds = [...new Set(input.destinatarioIds)];
  const destOk = await prisma.usuario.findMany({
    where: { id: { in: destIds }, ativo: true },
    select: { id: true },
  });
  if (destOk.length !== destIds.length || destIds.length === 0) {
    throw new AppError(400, "Informe ao menos um destinatário válido");
  }

  const byId = new Map(pedido.itens.map((i) => [i.id, i]));
  if (input.itens.length !== pedido.itens.length) {
    throw new AppError(400, "Informe todos os itens do pedido");
  }

  const itensMov: Array<{
    produtoId: string;
    quantidade: number;
    series?: string[];
  }> = [];

  for (const line of input.itens) {
    const item = byId.get(line.id);
    if (!item) throw new AppError(400, "Item do pedido inválido");
    if (!item.produtoId || !item.produto) {
      throw new AppError(
        400,
        `SKU ${item.codigoProprio} não encontrado no cadastro TEEP`
      );
    }
    if (!qtyEq(Number(item.quantidade), line.quantidade)) {
      throw new AppError(
        400,
        `Quantidade do item ${item.codigoProprio} deve ser ${Number(item.quantidade)}`
      );
    }
    if (item.produto.controlaSerie) {
      const n = Math.round(line.quantidade);
      if (!Number.isInteger(line.quantidade) && n !== line.quantidade) {
        throw new AppError(
          400,
          `Produto ${item.codigoProprio} controla série: quantidade deve ser inteira`
        );
      }
      if (!line.series || line.series.length !== n) {
        throw new AppError(
          400,
          `Informe ${n} número(s) de série para ${item.codigoProprio}`
        );
      }
    }
    itensMov.push({
      produtoId: item.produtoId,
      quantidade: line.quantidade,
      series: line.series,
    });
  }

  const itensLancamento = agruparItensSaidaPedido(itensMov);
  const grupoId = randomUUID();

  await prisma.$transaction([
    prisma.pedidoVendaDestinatario.deleteMany({ where: { pedidoId } }),
    prisma.pedidoVendaDestinatario.createMany({
      data: destIds.map((usuarioId) => ({ pedidoId, usuarioId })),
    }),
    prisma.pedidoVenda.update({
      where: { id: pedidoId },
      data: {
        filialAcabadoId: filial.id,
        grupoLancamentoId: grupoId,
        separadoPorId: user.id,
      },
    }),
  ]);

  await criarMovimentacao(user, {
    tipoId: tipo.id,
    filialId: filial.id,
    itens: itensLancamento,
    observacao: `Pedido eGestor ${pedido.egestorCodigo}`,
    usoInternoPedido: true,
    grupoLancamentoId: grupoId,
  });

  await syncPedidoAposGrupoLancamento(grupoId);
  return obterPedido(pedidoId);
}

async function retomarSeparacaoExistente(pedidoId: string, grupoId: string) {
  const movs = await prisma.movimentacao.findMany({
    where: { grupoLancamentoId: grupoId },
    select: { status: true },
  });
  if (movs.some((m) => m.status === "PENDENTE")) {
    throw new AppError(
      400,
      "Separação aguardando aprovação — não é possível lançar de novo"
    );
  }
  if (movs.some((m) => m.status === "CONCLUIDO")) {
    await syncPedidoAposGrupoLancamento(grupoId);
    return obterPedido(pedidoId);
  }
  await prisma.pedidoVenda.update({
    where: { id: pedidoId },
    data: { grupoLancamentoId: null, filialAcabadoId: null },
  });
  return null;
}
