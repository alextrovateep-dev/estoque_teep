import { prisma } from "./prisma";

type TipoSistema = {
  nome: string;
  operacao: "ENTRADA" | "SAIDA" | "TRANSFERENCIA";
  requerCliente: boolean;
  requerAprovacao: boolean;
  permitidoOperador: boolean;
  permitidoGerente: boolean;
  descricao: string;
  baixaPorArvore?: boolean;
};

/**
 * Tipos internos referenciados pelo código (inventário, transferência, árvore).
 * Não são cadastro de negócio — `sistema: true` e ficam fora da lista de cadastro / lançamento
 * (exceto Transferência entre estoques no Novo Lançamento).
 * RMA usa tipos cadastrados pelo admin com flags `rmaEntradaEstoque` / `rmaSaidaCliente`.
 */
const TIPOS_SISTEMA: TipoSistema[] = [
  {
    nome: "Inventário / Saldo Inicial",
    operacao: "ENTRADA",
    requerCliente: false,
    requerAprovacao: true,
    permitidoOperador: false,
    permitidoGerente: false,
    descricao: "Somente via Inicialização de Estoque",
  },
  {
    nome: "Transferência Recebida",
    operacao: "ENTRADA",
    requerCliente: false,
    requerAprovacao: false,
    permitidoOperador: false,
    permitidoGerente: false,
    descricao: "Gerado pelo módulo Transferências na conferência do destino",
  },
  {
    nome: "Ajuste Positivo",
    operacao: "ENTRADA",
    requerCliente: false,
    requerAprovacao: true,
    permitidoOperador: false,
    permitidoGerente: true,
    descricao: "Usado pelo Inventário / saldo inicial",
  },
  {
    nome: "Baixa de componente (árvore)",
    operacao: "SAIDA",
    requerCliente: false,
    requerAprovacao: false,
    permitidoOperador: false,
    permitidoGerente: false,
    descricao:
      "Gerado automaticamente ao baixar um componente da árvore (saída ou transferência)",
    baixaPorArvore: false,
  },
  {
    nome: "Transferência Enviada",
    operacao: "SAIDA",
    requerCliente: false,
    requerAprovacao: false,
    permitidoOperador: false,
    permitidoGerente: false,
    descricao: "Gerado pelo módulo Transferências (F8)",
  },
  {
    nome: "Ajuste Negativo",
    operacao: "SAIDA",
    requerCliente: false,
    requerAprovacao: true,
    permitidoOperador: false,
    permitidoGerente: true,
    descricao: "Usado pelo Inventário / saldo inicial",
  },
  {
    nome: "Estorno",
    operacao: "ENTRADA",
    requerCliente: false,
    requerAprovacao: true,
    permitidoOperador: false,
    permitidoGerente: false,
    descricao: "Gerado pelo sistema ao estornar",
  },
  {
    nome: "Transferência entre estoques",
    operacao: "TRANSFERENCIA",
    requerCliente: false,
    requerAprovacao: false,
    permitidoOperador: true,
    permitidoGerente: true,
    descricao:
      "Lançamento A->B: creditar destino agora ou aguardar confirmação de recebimento (F15)",
  },
];

async function renameTipoLegado(from: string, to: string) {
  const antigo = await prisma.tipoMovimentacao.findUnique({
    where: { nome: from },
  });
  if (!antigo) return;
  const novo = await prisma.tipoMovimentacao.findUnique({
    where: { nome: to },
  });
  if (novo) {
    if (antigo.id !== novo.id) {
      await prisma.tipoMovimentacao.update({
        where: { id: antigo.id },
        data: { ativo: false, baixaPorArvore: false },
      });
    }
    return;
  }
  await prisma.tipoMovimentacao.update({
    where: { id: antigo.id },
    data: { nome: to },
  });
}

async function removeTiposRmaFixosLegado() {
  for (const nome of ["Entrada RMA", "Saída RMA"]) {
    const t = await prisma.tipoMovimentacao.findUnique({ where: { nome } });
    if (!t) continue;
    const usados = await prisma.movimentacao.count({ where: { tipoId: t.id } });
    if (usados > 0) {
      // Histórico: mantém o tipo só para movimentações antigas; RMA novo exige cadastro.
      await prisma.tipoMovimentacao.update({
        where: { id: t.id },
        data: { rmaEntradaEstoque: false, rmaSaidaCliente: false },
      });
      continue;
    }
    await prisma.tipoMovimentacao.delete({ where: { id: t.id } }).catch(() => {});
  }
}

/** Garante tipos internos. Idempotente — seguro no boot e no seed. */
export async function ensureSystemTipos(): Promise<number> {
  await renameTipoLegado("Consumo Montagem", "Baixa de componente (árvore)");
  await removeTiposRmaFixosLegado();

  for (const t of TIPOS_SISTEMA) {
    const { baixaPorArvore, ...base } = t;
    await prisma.tipoMovimentacao.upsert({
      where: { nome: t.nome },
      update: {
        operacao: base.operacao,
        requerCliente: base.requerCliente,
        requerAprovacao: base.requerAprovacao,
        permitidoOperador: base.permitidoOperador,
        permitidoGerente: base.permitidoGerente,
        sistema: true,
        descricao: base.descricao,
        baixaPorArvore: baixaPorArvore === true,
        ativo: true,
      },
      create: {
        ...base,
        sistema: true,
        baixaPorArvore: baixaPorArvore === true,
      },
    });
  }

  return TIPOS_SISTEMA.length;
}
