import { randomUUID } from "crypto";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { operadorFilialIds } from "../lib/filialScope";
import { agruparItensSaidaPedido } from "../lib/pedidoSeparacaoItens";
import {
  clienteIdPorDocumento,
  indexClientesPorCnpj,
  interpretarDocumentoContatoEgestor,
  mensagemBloqueioSeparacaoCliente,
} from "../lib/pedidoClienteMatch";
import { criarMovimentacao } from "./movimentacaoService";
import { notificarPedidoSeparado } from "./alertaService";

const pedidoInclude = {
  filialAcabado: { select: { id: true, nome: true, sigla: true } },
  separadoPor: { select: { id: true, nome: true, email: true } },
  cliente: {
    select: { id: true, nome: true, documento: true, ativo: true },
  },
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
      cliente: { select: { id: true, nome: true, documento: true } },
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

  const estado = await estadoSeparacaoPedido(row);
  // Releitura após possível heal (órfão limpo ou SEPARADO aplicado)
  const fresh =
    estado.grupoOrfao || row.grupoLancamentoId
      ? await prisma.pedidoVenda.findUnique({
          where: { id },
          include: pedidoInclude,
        })
      : row;
  if (!fresh) throw new AppError(404, "Pedido não encontrado");

  let aguardandoAprovacao = false;
  if (fresh.status === "ABERTO" && fresh.grupoLancamentoId) {
    const movs = await prisma.movimentacao.findMany({
      where: { grupoLancamentoId: fresh.grupoLancamentoId },
      select: { status: true },
    });
    aguardandoAprovacao = movs.some((m) => m.status === "PENDENTE");
  }

  return { ...fresh, aguardandoAprovacao };
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

/** Resolve/atualiza o Cliente TEEP pelo CNPJ do contato eGestor. */
async function resolverClientePedido(pedido: {
  id: string;
  documentoContato: string | null;
  clienteId: string | null;
}): Promise<{ clienteId: string; documentoContato: string }> {
  let documentoContato = pedido.documentoContato;
  const interp = interpretarDocumentoContatoEgestor(documentoContato);
  if (interp.bloqueio || !interp.documentoContato) {
    throw new AppError(
      400,
      interp.bloqueio ||
        "Contato do pedido sem CNPJ válido — atualize do eGestor"
    );
  }
  documentoContato = interp.documentoContato;

  if (pedido.clienteId) {
    const ativo = await prisma.cliente.findFirst({
      where: { id: pedido.clienteId, ativo: true },
      select: { id: true, documento: true },
    });
    if (ativo) {
      if (documentoContato !== pedido.documentoContato) {
        await prisma.pedidoVenda.update({
          where: { id: pedido.id },
          data: { documentoContato },
        });
      }
      return { clienteId: ativo.id, documentoContato };
    }
  }

  const clientes = await prisma.cliente.findMany({
    where: { ativo: true, documento: { not: null } },
    select: { id: true, documento: true, ativo: true },
  });
  const clienteId = clienteIdPorDocumento(
    indexClientesPorCnpj(clientes),
    documentoContato
  );
  const bloqueio = mensagemBloqueioSeparacaoCliente({
    documentoContato,
    clienteId,
  });
  if (bloqueio || !clienteId) {
    throw new AppError(400, bloqueio || "Cliente não encontrado no TEEP");
  }

  await prisma.pedidoVenda.update({
    where: { id: pedido.id },
    data: { documentoContato, clienteId },
  });
  return { clienteId, documentoContato };
}

export async function syncPedidoAposGrupoLancamento(grupoId: string) {
  const pedido = await prisma.pedidoVenda.findFirst({
    where: { grupoLancamentoId: grupoId },
    include: {
      destinatarios: true,
      filialAcabado: { select: { sigla: true } },
      cliente: { select: { nome: true } },
      itens: { select: { produtoId: true } },
    },
  });
  if (!pedido || pedido.status === "SEPARADO") return;

  const movs = await prisma.movimentacao.findMany({
    where: { grupoLancamentoId: grupoId },
    select: { status: true, produtoId: true },
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

  if (movs.some((m) => m.status === "PENDENTE")) {
    return;
  }

  // Só finaliza quando todas as linhas do grupo existem e estão concluídas
  // (evita marcar SEPARADO no 1º SKU de um pedido multi-item).
  const skusEsperados = new Set(
    pedido.itens.map((i) => i.produtoId).filter((id): id is string => Boolean(id))
  );
  const skusLancados = new Set(movs.map((m) => m.produtoId).filter(Boolean));
  if (
    skusEsperados.size > 0 &&
    (movs.length < skusEsperados.size ||
      [...skusEsperados].some((id) => !skusLancados.has(id)))
  ) {
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
        clienteNome: pedido.cliente?.nome || pedido.nomeContato,
        filialSigla: pedido.filialAcabado?.sigla || "—",
        destinatarioIds: destIds,
      });
    }
  }
}

/** Estado real da separação (não confiar só em grupoLancamentoId na UI). */
export async function estadoSeparacaoPedido(pedido: {
  id: string;
  status: string;
  grupoLancamentoId: string | null;
}): Promise<{
  aguardandoAprovacao: boolean;
  grupoOrfao: boolean;
}> {
  if (pedido.status !== "ABERTO" || !pedido.grupoLancamentoId) {
    return { aguardandoAprovacao: false, grupoOrfao: false };
  }
  const movs = await prisma.movimentacao.findMany({
    where: { grupoLancamentoId: pedido.grupoLancamentoId },
    select: { status: true },
  });
  if (movs.length === 0) {
    await prisma.pedidoVenda.update({
      where: { id: pedido.id },
      data: { grupoLancamentoId: null, filialAcabadoId: null },
    });
    return { aguardandoAprovacao: false, grupoOrfao: true };
  }
  if (movs.some((m) => m.status === "PENDENTE")) {
    return { aguardandoAprovacao: true, grupoOrfao: false };
  }
  if (movs.every((m) => m.status === "CONCLUIDO")) {
    await syncPedidoAposGrupoLancamento(pedido.grupoLancamentoId);
  }
  return { aguardandoAprovacao: false, grupoOrfao: false };
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

  const { clienteId } = await resolverClientePedido(pedido);

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
        clienteId,
      },
    }),
  ]);

  await criarMovimentacao(user, {
    tipoId: tipo.id,
    filialId: filial.id,
    clienteId,
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
