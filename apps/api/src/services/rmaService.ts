import {
  SIGLA_ESTOQUE_RMA,
  TIPO_ENTRADA_RMA,
  TIPO_SAIDA_RMA,
} from "@teep/shared";
import { prisma } from "../lib/prisma";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { assertOperadorPodeFilial, operadorFilialIds } from "../lib/filialScope";
import {
  assertExtForRmaTipo,
  extFromPublicUrl,
  isValidRmaTmpPath,
  promoteRmaTmpToAtual,
  rollbackRmaPromote,
  type RmaAnexoTipo,
  type RmaPromoteResult,
} from "../lib/rmaUploads";
import { criarMovimentacao, estornarMovimentacao } from "./movimentacaoService";
import {
  criarTransferenciaImediata,
  reverterTransferenciaImediata,
} from "./transferenciaService";
import { parseDiaCivilSaoPaulo } from "./movimentacoesExportService";
import { resolveRmaDefaults } from "../lib/rmaDefaults";
import {
  notificarRmaAberto,
  notificarRmaEncerrado,
  notificarRmaFinanceiro,
} from "./alertaService";

const ITEM_NO_RMA = ["EM_ESTOQUE", "SEM_MANUTENCAO"] as const;

const movVinculoSelect = {
  id: true,
  status: true,
  dataMovimento: true,
  transferenciaItem: {
    select: { transferenciaId: true },
  },
} as const;

const anexoSelect = {
  id: true,
  tipo: true,
  arquivo: true,
  label: true,
  itemId: true,
  ativo: true,
  substituidoEm: true,
  criadoEm: true,
} as const;

const processoInclude = {
  cliente: { select: { id: true, nome: true, documento: true, tipo: true } },
  filial: { select: { id: true, nome: true, sigla: true } },
  criadoPor: { select: { id: true, nome: true } },
  anexos: {
    select: anexoSelect,
    orderBy: [{ ativo: "desc" as const }, { criadoEm: "desc" as const }],
  },
  itens: {
    include: {
      produto: {
        select: {
          id: true,
          codigo: true,
          descricao: true,
          controlaSerie: true,
          unidade: true,
        },
      },
      unidadeSerie: {
        select: { id: true, numeroSerie: true, status: true, filialId: true },
      },
      unidadeSerieSubstituicao: {
        select: { id: true, numeroSerie: true, status: true, filialId: true },
      },
      anexos: {
        select: anexoSelect,
        orderBy: [{ ativo: "desc" as const }, { criadoEm: "desc" as const }],
      },
      movEntrada: { select: movVinculoSelect },
      movSaida: { select: movVinculoSelect },
      movDescarte: { select: movVinculoSelect },
    },
    orderBy: { id: "asc" as const },
  },
};

async function arquivoAnexoAtivo(
  processoId: string,
  tipo: RmaAnexoTipo,
  itemId?: string | null
): Promise<string | null> {
  const row = await prisma.rmaAnexo.findFirst({
    where: {
      processoId,
      tipo,
      ativo: true,
      itemId: itemId ?? null,
    },
    select: { arquivo: true },
  });
  return row?.arquivo ?? null;
}

async function resolveFilialPorSigla(sigla: string) {
  const f = await prisma.filial.findFirst({
    where: { sigla, ativo: true },
  });
  if (!f) {
    throw new AppError(
      400,
      `Estoque ${sigla} não cadastrado. Cadastre em Admin → Estoques.`
    );
  }
  return f;
}

async function tipoPorNome(nome: string) {
  const t = await prisma.tipoMovimentacao.findFirst({
    where: { nome, ativo: true },
  });
  if (!t) throw new AppError(400, `Tipo "${nome}" não encontrado — rode o seed`);
  return t;
}

/** Saída RMA compartilhada (devolução e troca). */
async function lancarSaidaRma(
  user: AuthUser,
  opts: {
    tipoSaidaId: string;
    produtoId: string;
    filialId: string;
    clienteId: string;
    quantidade: number;
    numeroSerie: string;
    notaFiscalNumero?: string | null;
    notaFiscalArquivo?: string | null;
    observacao: string;
  }
) {
  const result = await criarMovimentacao(user, {
    tipoId: opts.tipoSaidaId,
    produtoId: opts.produtoId,
    filialId: opts.filialId,
    clienteId: opts.clienteId,
    quantidade: opts.quantidade,
    series: [opts.numeroSerie],
    notaFiscalNumero: opts.notaFiscalNumero ?? null,
    notaFiscalArquivo: opts.notaFiscalArquivo ?? null,
    observacao: opts.observacao,
  });
  const mov = result.movimentacao;
  if (!mov?.id || mov.status === "PENDENTE") {
    throw new AppError(400, "Falha ao lançar saída RMA");
  }
  return mov;
}

function assertPodeVerProcesso(user: AuthUser, filialId: string) {
  if (user.perfil === "OPERADOR") {
    assertOperadorPodeFilial(user, filialId);
  }
}

async function maybeFecharProcesso(processoId: string) {
  const abertos = await prisma.rmaItem.count({
    where: {
      processoId,
      status: { in: ["ABERTO", "EM_ESTOQUE", "SEM_MANUTENCAO"] },
    },
  });
  if (abertos === 0) {
    const before = await prisma.rmaProcesso.findUnique({
      where: { id: processoId },
      select: {
        status: true,
        cliente: { select: { nome: true } },
      },
    });
    if (
      !before ||
      before.status === "FECHADO" ||
      before.status === "CANCELADO"
    ) {
      return;
    }
    await prisma.rmaProcesso.update({
      where: { id: processoId },
      data: { status: "FECHADO" },
    });
    notificarRmaEncerrado({
      processoId,
      clienteNome: before.cliente.nome,
      status: "FECHADO",
    });
  }
}

export async function listarRma(
  user: AuthUser,
  q: {
    status?: string;
    clienteId?: string;
    cobrou?: string;
    dataInicio?: string;
    dataFim?: string;
    page?: number;
    pageSize?: number;
  }
) {
  const page = Math.max(1, q.page || 1);
  const pageSize = Math.min(50, Math.max(1, q.pageSize || 20));
  const where: Record<string, unknown> = {};

  if (user.perfil === "OPERADOR") {
    const ids = operadorFilialIds(user);
    where.filialId = { in: ids };
  }
  if (q.status) where.status = q.status;
  if (q.clienteId) where.clienteId = q.clienteId;
  if (q.cobrou === "true") where.cobrou = true;
  if (q.cobrou === "false") where.cobrou = false;
  if (q.cobrou === "null") where.cobrou = null;

  const criadoEm: { gte?: Date; lte?: Date } = {};
  if (q.dataInicio) {
    const d = parseDiaCivilSaoPaulo(q.dataInicio, "inicio");
    if (d) criadoEm.gte = d;
  }
  if (q.dataFim) {
    const d = parseDiaCivilSaoPaulo(q.dataFim, "fim");
    if (d) criadoEm.lte = d;
  }
  if (criadoEm.gte || criadoEm.lte) where.criadoEm = criadoEm;

  const [total, data] = await Promise.all([
    prisma.rmaProcesso.count({ where }),
    prisma.rmaProcesso.findMany({
      where,
      include: {
        cliente: { select: { id: true, nome: true, documento: true } },
        filial: { select: { id: true, sigla: true, nome: true } },
        _count: { select: { itens: true } },
      },
      orderBy: { criadoEm: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { data, total, page, pageSize };
}

export async function obterRma(user: AuthUser, id: string) {
  const row = await prisma.rmaProcesso.findUnique({
    where: { id },
    include: processoInclude,
  });
  if (!row) throw new AppError(404, "Processo RMA não encontrado");
  assertPodeVerProcesso(user, row.filialId);
  return row;
}

export async function criarRmaProcesso(
  user: AuthUser,
  input: {
    clienteId: string;
    observacao?: string | null;
    nfEntradaNumero?: string | null;
    nfEntradaArquivo?: string | null;
    itens: Array<{
      produtoId: string;
      series: string[];
      observacao?: string | null;
    }>;
  }
) {
  const defaults = await resolveRmaDefaults();
  const estoqueRma = defaults.filialPreparacao
    ? {
        id: defaults.filialPreparacao.id,
        sigla: defaults.filialPreparacao.sigla,
      }
    : await resolveFilialPorSigla(SIGLA_ESTOQUE_RMA);
  if (user.perfil === "OPERADOR") {
    assertOperadorPodeFilial(user, estoqueRma.id);
  }

  const cliente = await prisma.cliente.findFirst({
    where: { id: input.clienteId, ativo: true },
  });
  if (!cliente) throw new AppError(400, "Cliente inválido");

  if (input.nfEntradaArquivo) {
    if (!isValidRmaTmpPath(input.nfEntradaArquivo, user.id)) {
      throw new AppError(
        400,
        "Arquivo de NF entrada inválido — envie via upload context=rma"
      );
    }
    const ext = extFromPublicUrl(input.nfEntradaArquivo);
    try {
      if (!ext) throw new Error("Extensão inválida");
      assertExtForRmaTipo("NF_ENTRADA", ext);
    } catch (e) {
      throw new AppError(
        400,
        e instanceof Error ? e.message : "Arquivo de NF entrada inválido"
      );
    }
  }

  const tipoEntrada = await tipoPorNome(TIPO_ENTRADA_RMA);

  type Linha = {
    produtoId: string;
    codigo: string;
    quantidade: number;
    series: string[];
    observacao?: string | null;
  };
  const linhas: Linha[] = [];
  const seriesVistas = new Set<string>();

  for (const it of input.itens) {
    const produto = await prisma.produto.findFirst({
      where: { id: it.produtoId, ativo: true },
    });
    if (!produto) throw new AppError(400, "Produto inválido");
    if (!produto.controlaSerie) {
      throw new AppError(
        400,
        `Produto ${produto.codigo} precisa controlar número de série para RMA`
      );
    }
    const series = (it.series || []).map((s) => s.trim()).filter(Boolean);
    if (series.length === 0) {
      throw new AppError(
        400,
        `Informe o número de série do produto ${produto.codigo}`
      );
    }
    for (const sn of series) {
      const key = `${produto.id}::${sn.toLowerCase()}`;
      if (seriesVistas.has(key)) {
        throw new AppError(
          400,
          `Número de série duplicado na nota: ${produto.codigo} / ${sn}`
        );
      }
      seriesVistas.add(key);
      linhas.push({
        produtoId: produto.id,
        codigo: produto.codigo,
        quantidade: 1,
        series: [sn],
        observacao: it.observacao,
      });
    }
  }

  if (linhas.length === 0) {
    throw new AppError(400, "Informe ao menos um produto com série");
  }
  if (linhas.length > 50) {
    throw new AppError(400, "Máximo de 50 produtos por nota de RMA");
  }

  const processo = await prisma.rmaProcesso.create({
    data: {
      clienteId: cliente.id,
      filialId: estoqueRma.id,
      status: "ABERTO",
      nfEntradaNumero: input.nfEntradaNumero?.trim() || null,
      observacao: input.observacao?.trim() || null,
      criadoPorId: user.id,
    },
  });

  // NF fica em _tmp até as entradas confirmarem — evita órfão em atual/ se rollback
  const nfTmp = input.nfEntradaArquivo || null;
  const feitos: Array<{ movEntradaId: string; itemId?: string }> = [];

  try {
    for (const linha of linhas) {
      const result = await criarMovimentacao(user, {
        tipoId: tipoEntrada.id,
        produtoId: linha.produtoId,
        filialId: estoqueRma.id,
        clienteId: cliente.id,
        quantidade: linha.quantidade,
        series: linha.series,
        notaFiscalNumero: input.nfEntradaNumero?.trim() || null,
        notaFiscalArquivo: nfTmp,
        permitirReativarSaido: true,
        observacao: `RMA ${processo.id.slice(0, 8)}${
          linha.observacao ? ` — ${linha.observacao}` : ""
        }`,
      });

      if (result.fluxo && result.fluxo !== "LANCAMENTO") {
        throw new AppError(400, "Falha ao lançar entrada RMA");
      }
      const mov = result.movimentacao;
      if (!mov?.id) throw new AppError(500, "Entrada RMA sem movimentação");
      if (mov.status === "PENDENTE") {
        throw new AppError(
          400,
          "Entrada RMA ficou pendente de aprovação — ajuste o tipo Entrada RMA"
        );
      }

      feitos.push({ movEntradaId: mov.id });

      const unidadeSerieId =
        mov.series?.[0]?.unidadeSerie?.id ||
        (
          await prisma.unidadeSerie.findFirst({
            where: {
              produtoId: linha.produtoId,
              numeroSerie: {
                equals: linha.series[0],
                mode: "insensitive",
              },
            },
            select: { id: true },
          })
        )?.id ||
        null;

      if (!unidadeSerieId) {
        throw new AppError(
          500,
          `Entrada RMA sem vínculo de série (${linha.codigo} / ${linha.series[0]})`
        );
      }

      const item = await prisma.rmaItem.create({
        data: {
          processoId: processo.id,
          produtoId: linha.produtoId,
          unidadeSerieId,
          quantidade: linha.quantidade,
          status: "EM_ESTOQUE",
          movEntradaId: mov.id,
          observacao: linha.observacao?.trim() || null,
        },
      });
      feitos[feitos.length - 1].itemId = item.id;
    }
  } catch (e) {
    const falhasComp: string[] = [];
    for (const f of [...feitos].reverse()) {
      try {
        await estornarMovimentacao(
          user,
          f.movEntradaId,
          `Rollback abertura RMA ${processo.id.slice(0, 8)}`,
          { bypassPerfil: true }
        );
        if (f.itemId) {
          await prisma.rmaItem.delete({ where: { id: f.itemId } }).catch(() => {
            /* item pode já ter sido removido */
          });
        }
      } catch (compErr) {
        falhasComp.push(f.movEntradaId);
        console.error(
          "[rma] falha ao compensar entrada após erro na abertura",
          f.movEntradaId,
          compErr
        );
      }
    }

    if (falhasComp.length > 0) {
      // Não apaga o processo: entradas sem estorno precisam permanecer rastreáveis
      const orig = e instanceof Error ? e.message : "Falha ao abrir RMA";
      throw new AppError(
        500,
        `${orig}. Rollback incompleto (${falhasComp.length} entrada(s) sem estorno) — processo ${processo.id.slice(0, 8)} mantido para conferência.`
      );
    }

    try {
      await prisma.rmaItem.deleteMany({ where: { processoId: processo.id } });
      await prisma.rmaProcesso.delete({ where: { id: processo.id } });
    } catch (delErr) {
      console.error("[rma] falha ao apagar processo após rollback", delErr);
      const orig = e instanceof Error ? e.message : "Falha ao abrir RMA";
      throw new AppError(
        500,
        `${orig}. Rollback de estoque ok, mas o processo ${processo.id.slice(0, 8)} não pôde ser removido — cancele-o manualmente.`
      );
    }
    if (e instanceof AppError) throw e;
    throw new AppError(
      400,
      e instanceof Error ? e.message : "Falha ao abrir RMA"
    );
  }

  // Estoque ok — promove NF tmp → atual/ e registra (consultável)
  if (nfTmp) {
    let placed: RmaPromoteResult | null = null;
    try {
      placed = promoteRmaTmpToAtual({
        processoId: processo.id,
        tipo: "NF_ENTRADA",
        tmpPublicUrl: nfTmp,
      });
      const movIds = feitos.map((f) => f.movEntradaId);
      await prisma.$transaction(async (tx) => {
        await tx.rmaAnexo.create({
          data: {
            processoId: processo.id,
            tipo: "NF_ENTRADA",
            arquivo: placed!.publicUrl,
            label: "NF entrada",
            ativo: true,
          },
        });
        if (movIds.length > 0) {
          await tx.movimentacao.updateMany({
            where: { id: { in: movIds } },
            data: { notaFiscalArquivo: placed!.publicUrl },
          });
        }
      });
    } catch (e) {
      if (placed) rollbackRmaPromote(placed);
      console.error(
        "[rma] estoque ok, falha ao gravar NF entrada — reanexar na tela do RMA",
        processo.id,
        e
      );
      // Não falha a abertura (evita reenvio duplicado); NF fica em _tmp para Trocar/Anexar
    }
  }

  notificarRmaAberto({
    processoId: processo.id,
    clienteNome: cliente.nome,
    qtdItens: linhas.length,
    criadoPorNome: user.nome,
  });

  return obterRma(user, processo.id);
}

export async function atualizarRmaFinanceiro(
  user: AuthUser,
  id: string,
  input: {
    nfEntradaNumero?: string | null;
    nfSaidaNumero?: string | null;
    cobrou?: boolean | null;
    valorCobrado?: number | null;
    nfCobrancaNumero?: string | null;
    observacao?: string | null;
  }
) {
  const proc = await prisma.rmaProcesso.findUnique({ where: { id } });
  if (!proc) throw new AppError(404, "Processo RMA não encontrado");
  assertPodeVerProcesso(user, proc.filialId);
  if (proc.status === "CANCELADO" || proc.status === "FECHADO") {
    throw new AppError(
      400,
      `Processo ${proc.status === "CANCELADO" ? "cancelado" : "fechado"} — não é possível alterar o financeiro`
    );
  }

  const cobrou =
    input.cobrou === undefined ? proc.cobrou : input.cobrou;
  const data: Record<string, unknown> = {};
  if (input.nfEntradaNumero !== undefined) {
    data.nfEntradaNumero = input.nfEntradaNumero?.trim() || null;
  }
  if (input.nfSaidaNumero !== undefined) {
    data.nfSaidaNumero = input.nfSaidaNumero?.trim() || null;
  }
  if (input.cobrou !== undefined) data.cobrou = input.cobrou;
  if (input.observacao !== undefined) {
    data.observacao = input.observacao?.trim() || null;
  }

  if (cobrou === true) {
    const valor =
      input.valorCobrado !== undefined
        ? input.valorCobrado
        : proc.valorCobrado != null
          ? Number(proc.valorCobrado)
          : null;
    const nfCob =
      input.nfCobrancaNumero !== undefined
        ? input.nfCobrancaNumero?.trim() || null
        : proc.nfCobrancaNumero;
    if (valor == null || !(valor > 0)) {
      throw new AppError(400, "Informe o valor cobrado (maior que zero)");
    }
    if (!nfCob) {
      throw new AppError(400, "Informe o número da NF de cobrança");
    }
    data.valorCobrado = valor;
    data.nfCobrancaNumero = nfCob;
  } else if (cobrou === false) {
    data.valorCobrado = null;
    data.nfCobrancaNumero = null;
  } else if (input.valorCobrado !== undefined) {
    data.valorCobrado = input.valorCobrado;
  } else if (input.nfCobrancaNumero !== undefined) {
    data.nfCobrancaNumero = input.nfCobrancaNumero?.trim() || null;
  }

  await prisma.rmaProcesso.update({ where: { id }, data });
  const atualizado = await obterRma(user, id);
  notificarRmaFinanceiro({
    processoId: id,
    clienteNome: atualizado.cliente.nome,
    cobrou: Boolean(atualizado.cobrou),
    valorCobrado:
      atualizado.valorCobrado != null ? Number(atualizado.valorCobrado) : null,
    nfCobrancaNumero: atualizado.nfCobrancaNumero,
  });
  return atualizado;
}

export async function anexarRma(
  user: AuthUser,
  id: string,
  input: {
    tipo: string;
    arquivo: string;
    label?: string | null;
    itemId?: string | null;
  },
  opts?: { podeFinanceiro?: boolean }
) {
  const proc = await prisma.rmaProcesso.findUnique({ where: { id } });
  if (!proc) throw new AppError(404, "Processo RMA não encontrado");
  assertPodeVerProcesso(user, proc.filialId);
  if (proc.status === "CANCELADO" || proc.status === "FECHADO") {
    throw new AppError(
      400,
      `Processo ${proc.status === "CANCELADO" ? "cancelado" : "fechado"} — não é possível anexar`
    );
  }

  const tipo = input.tipo as RmaAnexoTipo;
  const precisaFin = tipo !== "LAUDO" && tipo !== "OUTRO";
  if (precisaFin && !opts?.podeFinanceiro) {
    throw new AppError(
      403,
      "Anexos de NF/cobrança exigem permissão RMA financeiro"
    );
  }

  if (!isValidRmaTmpPath(input.arquivo, user.id)) {
    throw new AppError(
      400,
      "Arquivo de anexo inválido — envie via upload context=rma"
    );
  }
  const ext = extFromPublicUrl(input.arquivo);
  try {
    if (!ext) throw new Error("Extensão de arquivo inválida");
    assertExtForRmaTipo(tipo, ext);
  } catch (e) {
    throw new AppError(
      400,
      e instanceof Error ? e.message : "Arquivo de anexo inválido"
    );
  }

  let itemId: string | null = input.itemId?.trim() || null;
  if (tipo === "LAUDO") {
    if (!itemId) {
      throw new AppError(
        400,
        "Informe o item (produto/série) para anexar o laudo"
      );
    }
    const item = await prisma.rmaItem.findFirst({
      where: { id: itemId, processoId: id },
      select: { id: true },
    });
    if (!item) throw new AppError(400, "Item RMA inválido para este processo");
  } else if (itemId) {
    itemId = null;
  }

  const label = input.label?.trim() || null;
  const substituivel =
    tipo === "LAUDO" ||
    tipo === "NF_ENTRADA" ||
    tipo === "NF_SAIDA" ||
    tipo === "NF_COBRANCA";

  let placed: RmaPromoteResult;
  try {
    placed = promoteRmaTmpToAtual({
      processoId: id,
      tipo,
      itemId,
      tmpPublicUrl: input.arquivo,
    });
  } catch (e) {
    throw new AppError(
      400,
      e instanceof Error ? e.message : "Falha ao gravar anexo RMA"
    );
  }

  const agora = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      if (substituivel) {
        const antigos = await tx.rmaAnexo.findMany({
          where: {
            processoId: id,
            tipo,
            ativo: true,
            ...(tipo === "LAUDO" ? { itemId } : { itemId: null }),
          },
          select: { id: true, arquivo: true },
        });
        for (const a of antigos) {
          const arquivoHist =
            placed.archivedPublicUrl && a.arquivo.includes("/atual/")
              ? placed.archivedPublicUrl
              : a.arquivo;
          await tx.rmaAnexo.update({
            where: { id: a.id },
            data: {
              ativo: false,
              substituidoEm: agora,
              arquivo: arquivoHist,
            },
          });
        }
      }

      await tx.rmaAnexo.create({
        data: {
          processoId: id,
          itemId,
          tipo,
          arquivo: placed.publicUrl,
          label,
          ativo: true,
        },
      });
    });
  } catch (e) {
    rollbackRmaPromote(placed);
    console.error("[rma] falha ao registrar anexo — promote revertido", id, e);
    throw new AppError(
      500,
      "Falha ao registrar anexo — arquivo devolvido ao temporário; tente novamente"
    );
  }

  return obterRma(user, id);
}

export async function devolverRmaItens(
  user: AuthUser,
  id: string,
  input: { itemIds?: string[]; nfSaidaNumero?: string | null }
) {
  const proc = await obterRma(user, id);
  if (proc.status === "CANCELADO") {
    const aindaNoRma = proc.itens.some((i) =>
      (ITEM_NO_RMA as readonly string[]).includes(i.status)
    );
    if (!aindaNoRma) {
      throw new AppError(400, "Processo cancelado");
    }
  }
  if (proc.status === "FECHADO") {
    throw new AppError(400, "Processo fechado — não é possível devolver");
  }

  const tipoSaida = await tipoPorNome(TIPO_SAIDA_RMA);

  let itens = proc.itens.filter((i) =>
    (ITEM_NO_RMA as readonly string[]).includes(i.status)
  );
  if (input.itemIds?.length) {
    const set = new Set(input.itemIds);
    itens = itens.filter((i) => set.has(i.id));
  }
  if (itens.length === 0) {
    throw new AppError(400, "Nenhum item no Estoque RMA para devolver");
  }

  const nfSaida =
    input.nfSaidaNumero?.trim() || proc.nfSaidaNumero || null;
  if (nfSaida && nfSaida !== proc.nfSaidaNumero) {
    await prisma.rmaProcesso.update({
      where: { id },
      data: { nfSaidaNumero: nfSaida },
    });
  }

  const nfSaidaArquivo = await arquivoAnexoAtivo(id, "NF_SAIDA");
  const feitos: Array<{
    itemId: string;
    movSaidaId: string;
    statusAnterior: string;
  }> = [];
  try {
    for (const item of itens) {
      if (!item.unidadeSerie?.numeroSerie) {
        throw new AppError(
          400,
          `Item ${item.produto.codigo} sem número de série vinculado`
        );
      }

      const statusAnterior = item.status;
      // Claim otimista: só um request pode pegar o item ainda no RMA
      const claim = await prisma.rmaItem.updateMany({
        where: {
          id: item.id,
          status: { in: [...ITEM_NO_RMA] },
        },
        data: { status: "DEVOLVIDO" },
      });
      if (claim.count === 0) {
        throw new AppError(
          409,
          `Item ${item.produto.codigo} já foi movimentado por outra operação`
        );
      }

      let saidaOk = false;
      let movSaidaId: string | null = null;
      try {
        const mov = await lancarSaidaRma(user, {
          tipoSaidaId: tipoSaida.id,
          produtoId: item.produtoId,
          filialId: proc.filialId,
          clienteId: proc.clienteId,
          quantidade: Number(item.quantidade),
          numeroSerie: item.unidadeSerie.numeroSerie,
          notaFiscalNumero: nfSaida,
          notaFiscalArquivo: nfSaidaArquivo,
          observacao: `Devolução RMA ${id.slice(0, 8)}`,
        });
        saidaOk = true;
        movSaidaId = mov.id;
        feitos.push({
          itemId: item.id,
          movSaidaId: mov.id,
          statusAnterior,
        });
        await prisma.rmaItem.update({
          where: { id: item.id },
          data: { movSaidaId: mov.id },
        });
      } catch (inner) {
        if (!saidaOk) {
          await prisma.rmaItem.update({
            where: { id: item.id },
            data: {
              status: statusAnterior,
              movSaidaId: null,
            },
          });
        } else if (movSaidaId) {
          try {
            await prisma.rmaItem.update({
              where: { id: item.id },
              data: { movSaidaId },
            });
          } catch {
            /* best-effort link */
          }
        }
        throw inner;
      }
    }
  } catch (e) {
    const falhasComp: string[] = [];
    for (const f of [...feitos].reverse()) {
      try {
        await estornarMovimentacao(
          user,
          f.movSaidaId,
          `Compensação devolução RMA parcial ${id.slice(0, 8)}`,
          { bypassPerfil: true }
        );
        await prisma.rmaItem.update({
          where: { id: f.itemId },
          data: { status: f.statusAnterior, movSaidaId: null },
        });
      } catch (compErr) {
        falhasComp.push(f.itemId);
        console.error(
          "[rma] falha ao compensar devolução parcial",
          f,
          compErr
        );
      }
    }
    if (falhasComp.length > 0) {
      const orig = e instanceof Error ? e.message : "Falha na devolução";
      throw new AppError(
        500,
        `${orig}. Além disso, não foi possível reverter ${falhasComp.length} item(ns) já devolvido(s) — confira o estoque RMA e o processo.`
      );
    }
    throw e;
  }

  await maybeFecharProcesso(id);
  return obterRma(user, id);
}

/** Marca itens no RMA como SEM_MANUTENCAO (decisão de processo; sem mover saldo). */
export async function marcarSemManutencaoRma(
  user: AuthUser,
  id: string,
  input: { itemIds: string[] }
) {
  const proc = await obterRma(user, id);
  if (proc.status === "CANCELADO" || proc.status === "FECHADO") {
    throw new AppError(
      400,
      `Processo ${proc.status === "CANCELADO" ? "cancelado" : "fechado"}`
    );
  }
  if (!input.itemIds?.length) {
    throw new AppError(400, "Informe ao menos um item");
  }

  const set = new Set(input.itemIds);
  const itens = proc.itens.filter(
    (i) => set.has(i.id) && i.status === "EM_ESTOQUE"
  );
  if (itens.length === 0) {
    throw new AppError(
      400,
      "Nenhum item EM_ESTOQUE selecionado para marcar sem manutenção"
    );
  }
  if (itens.length !== input.itemIds.length) {
    throw new AppError(
      400,
      "Só itens em estoque RMA podem ser marcados como sem manutenção"
    );
  }

  for (const item of itens) {
    const claim = await prisma.rmaItem.updateMany({
      where: { id: item.id, status: "EM_ESTOQUE" },
      data: { status: "SEM_MANUTENCAO" },
    });
    if (claim.count === 0) {
      throw new AppError(
        409,
        `Item ${item.produto.codigo} já foi movimentado — atualize a tela`
      );
    }
  }

  return obterRma(user, id);
}

function movSaidaDaTransferencia(transf: {
  itens: Array<{
    movimentacoes: Array<{ id: string; tipo: { operacao: string; nome: string } }>;
  }>;
}): string | null {
  for (const item of transf.itens) {
    const saida = item.movimentacoes.find(
      (m) => m.tipo.operacao === "SAIDA" || /enviad/i.test(m.tipo.nome)
    );
    if (saida) return saida.id;
  }
  for (const item of transf.itens) {
    if (item.movimentacoes[0]) return item.movimentacoes[0].id;
  }
  return null;
}

/**
 * Troca: traz série boa (transferência imediata origem → preparação),
 * expede ao cliente (Saída RMA), move série ruim para descarte (transferência).
 */
export async function trocarRmaItem(
  user: AuthUser,
  processoId: string,
  input: {
    itemId: string;
    origemFilialId: string;
    destinoPreparacaoFilialId?: string;
    numeroSerieBoa: string;
    destinoDescarteFilialId?: string;
    nfSaidaNumero?: string | null;
    observacao?: string | null;
  }
) {
  const proc = await obterRma(user, processoId);
  if (proc.status === "CANCELADO") {
    throw new AppError(400, "Processo cancelado");
  }
  if (proc.status === "FECHADO") {
    throw new AppError(400, "Processo fechado");
  }

  const item = proc.itens.find((i) => i.id === input.itemId);
  if (!item) throw new AppError(404, "Item não encontrado neste processo");
  if (item.status !== "SEM_MANUTENCAO") {
    throw new AppError(
      400,
      item.status === "EM_ESTOQUE"
        ? "Marque o item como Sem manutenção antes de trocar"
        : "Só itens Sem manutenção podem ser trocados"
    );
  }
  if (!item.unidadeSerie?.numeroSerie) {
    throw new AppError(400, "Item sem número de série vinculado");
  }

  const serieRuim = item.unidadeSerie.numeroSerie.trim();
  const serieBoa = input.numeroSerieBoa.trim();
  if (!serieBoa) throw new AppError(400, "Informe a série da peça substituta");
  if (serieBoa.toLowerCase() === serieRuim.toLowerCase()) {
    throw new AppError(
      400,
      "A série substituta deve ser diferente da série do item RMA"
    );
  }

  const destinoPrepId = input.destinoPreparacaoFilialId || proc.filialId;
  if (destinoPrepId !== proc.filialId) {
    throw new AppError(
      400,
      `Destino de preparação deve ser o estoque do processo (${proc.filial.sigla})`
    );
  }
  if (input.origemFilialId === destinoPrepId) {
    throw new AppError(
      400,
      "Origem da peça boa deve ser um estoque diferente do RMA"
    );
  }

  let destinoDescarteId = input.destinoDescarteFilialId;
  if (!destinoDescarteId) {
    const defs = await resolveRmaDefaults();
    destinoDescarteId = defs.filialDescarteId ?? undefined;
    if (!destinoDescarteId) {
      throw new AppError(
        400,
        "Informe o estoque de descarte (ou configure RMA_FILIAL_DESCARTE_ID / cadastre a filial DESC)"
      );
    }
  }
  if (destinoDescarteId === proc.filialId) {
    throw new AppError(400, "Estoque de descarte deve ser diferente do RMA");
  }

  const tipoSaida = await tipoPorNome(TIPO_SAIDA_RMA);
  const statusAnterior = item.status;

  const claim = await prisma.rmaItem.updateMany({
    where: {
      id: item.id,
      status: "SEM_MANUTENCAO",
    },
    data: {
      status: "DESCARTADO",
      observacao: input.observacao?.trim() || item.observacao,
    },
  });
  if (claim.count === 0) {
    throw new AppError(409, "Item já foi movimentado — atualize a tela");
  }

  let transfPrepId: string | null = null;
  let transfDescId: string | null = null;
  let movSaidaId: string | null = null;
  let movDescarteId: string | null = null;
  let unidadeSerieBoaId: string | null = null;

  try {
    // 1) Série boa: origem operacional → preparação (RMA)
    const prep = await criarTransferenciaImediata(user, {
      origemFilialId: input.origemFilialId,
      destinoFilialId: destinoPrepId,
      guiaTransporte: `RMA-troca-prep ${processoId.slice(0, 8)}`,
      itens: [
        {
          produtoId: item.produtoId,
          quantidade: 1,
          series: [serieBoa],
        },
      ],
    });
    transfPrepId = prep.transferencia.id;

    const boa = await prisma.unidadeSerie.findFirst({
      where: {
        produtoId: item.produtoId,
        numeroSerie: { equals: serieBoa, mode: "insensitive" },
      },
    });
    if (!boa) {
      throw new AppError(400, "Série substituta não encontrada após transferência");
    }
    unidadeSerieBoaId = boa.id;

    // 2) Expedir série boa ao cliente (Saída RMA)
    const nfSaida =
      input.nfSaidaNumero?.trim() || proc.nfSaidaNumero || null;
    if (nfSaida && nfSaida !== proc.nfSaidaNumero) {
      await prisma.rmaProcesso.update({
        where: { id: processoId },
        data: { nfSaidaNumero: nfSaida },
      });
    }
    const nfSaidaArquivo = await arquivoAnexoAtivo(processoId, "NF_SAIDA");
    const saida = await lancarSaidaRma(user, {
      tipoSaidaId: tipoSaida.id,
      produtoId: item.produtoId,
      filialId: destinoPrepId,
      clienteId: proc.clienteId,
      quantidade: 1,
      numeroSerie: serieBoa,
      notaFiscalNumero: nfSaida,
      notaFiscalArquivo: nfSaidaArquivo,
      observacao: `Troca RMA ${processoId.slice(0, 8)} — substitui ${serieRuim}`,
    });
    movSaidaId = saida.id;

    // 3) Série ruim: RMA → descarte
    const desc = await criarTransferenciaImediata(user, {
      origemFilialId: proc.filialId,
      destinoFilialId: destinoDescarteId,
      guiaTransporte: `RMA-descarte ${processoId.slice(0, 8)}`,
      itens: [
        {
          produtoId: item.produtoId,
          quantidade: 1,
          series: [serieRuim],
        },
      ],
    });
    transfDescId = desc.transferencia.id;
    movDescarteId = movSaidaDaTransferencia(desc.transferencia);
    if (!movDescarteId) {
      throw new AppError(
        500,
        "Transferência de descarte sem movimentação de saída — confira o estoque"
      );
    }

    await prisma.rmaItem.update({
      where: { id: item.id },
      data: {
        status: "DESCARTADO",
        movSaidaId,
        movDescarteId,
        unidadeSerieSubstituicaoId: unidadeSerieBoaId,
        observacao:
          input.observacao?.trim() ||
          `Trocado: saiu ${serieBoa}; ${serieRuim} → descarte`,
      },
    });
  } catch (e) {
    // Compensação (ordem inversa): saída RMA → descarte → preparação
    const motivo = `Compensação troca RMA ${processoId.slice(0, 8)}`;
    const falhas: string[] = [];

    if (movSaidaId) {
      try {
        await estornarMovimentacao(user, movSaidaId, motivo, {
          bypassPerfil: true,
        });
      } catch (err) {
        falhas.push("saida");
        console.error("[rma] falha compensar saída troca", err);
      }
    }
    if (transfDescId) {
      try {
        await reverterTransferenciaImediata(user, transfDescId, {
          bypassPerfil: true,
          motivo,
        });
      } catch (err) {
        falhas.push("descarte");
        console.error("[rma] falha compensar descarte troca", err);
      }
    }
    if (transfPrepId) {
      try {
        await reverterTransferenciaImediata(user, transfPrepId, {
          bypassPerfil: true,
          motivo,
        });
      } catch (err) {
        falhas.push("preparacao");
        console.error("[rma] falha compensar prep troca", err);
      }
    }

    await prisma.rmaItem.update({
      where: { id: item.id },
      data: {
        status: statusAnterior,
        movSaidaId: null,
        movDescarteId: null,
        unidadeSerieSubstituicaoId: null,
      },
    });

    if (falhas.length > 0) {
      const orig = e instanceof Error ? e.message : "Falha na troca RMA";
      throw new AppError(
        500,
        `${orig}. Compensação incompleta (${falhas.join(", ")}) — confira saldos e séries manualmente.`
      );
    }
    throw e;
  }

  await maybeFecharProcesso(processoId);
  return obterRma(user, processoId);
}

export async function cancelarRma(user: AuthUser, id: string) {
  const proc = await obterRma(user, id);
  if (proc.status === "CANCELADO") {
    throw new AppError(400, "Processo já cancelado");
  }
  if (proc.status === "FECHADO") {
    throw new AppError(
      400,
      "Processo fechado — não é possível cancelar (itens já devolvidos ao cliente)"
    );
  }

  const emEstoque = proc.itens.filter((i) =>
    (ITEM_NO_RMA as readonly string[]).includes(i.status)
  );
  if (emEstoque.length > 0 && user.perfil === "OPERADOR") {
    throw new AppError(
      403,
      "Com itens no Estoque RMA, só Gerente/Admin pode cancelar (estorna as entradas). Devolva ao cliente ou peça ao gerente."
    );
  }

  let cancelados = 0;
  try {
    for (const item of emEstoque) {
      if (!item.movEntradaId) {
        throw new AppError(400, "Item em estoque sem movimentação de entrada");
      }

      const claim = await prisma.rmaItem.updateMany({
        where: {
          id: item.id,
          status: { in: [...ITEM_NO_RMA] },
        },
        data: { status: "CANCELADO" },
      });
      if (claim.count === 0) {
        throw new AppError(
          409,
          `Item ${item.produto.codigo} já foi movimentado — atualize a tela e tente de novo`
        );
      }

      try {
        await estornarMovimentacao(
          user,
          item.movEntradaId,
          `Cancelamento RMA ${id.slice(0, 8)}`,
          { bypassPerfil: true }
        );
        cancelados += 1;
      } catch (inner) {
        await prisma.rmaItem.update({
          where: { id: item.id },
          data: {
            status:
              item.status === "SEM_MANUTENCAO" ? "SEM_MANUTENCAO" : "EM_ESTOQUE",
          },
        });
        throw inner;
      }
    }
  } catch (e) {
    const restantes = await prisma.rmaItem.count({
      where: {
        processoId: id,
        status: { in: [...ITEM_NO_RMA] },
      },
    });
    if (restantes === 0) {
      await prisma.rmaItem.updateMany({
        where: { processoId: id, status: "ABERTO" },
        data: { status: "CANCELADO" },
      });
      await prisma.rmaProcesso.update({
        where: { id },
        data: { status: "CANCELADO" },
      });
      notificarRmaEncerrado({
        processoId: id,
        clienteNome: proc.cliente.nome,
        status: "CANCELADO",
      });
    }
    const orig = e instanceof Error ? e.message : "Falha ao cancelar RMA";
    if (cancelados > 0 && restantes > 0) {
      throw new AppError(
        e instanceof AppError ? e.status : 400,
        `${orig}. ${cancelados} item(ns) já estornado(s); restam ${restantes} em estoque — tente cancelar de novo.`
      );
    }
    throw e;
  }

  await prisma.rmaItem.updateMany({
    where: { processoId: id, status: "ABERTO" },
    data: { status: "CANCELADO" },
  });
  await prisma.rmaProcesso.update({
    where: { id },
    data: { status: "CANCELADO" },
  });
  notificarRmaEncerrado({
    processoId: id,
    clienteNome: proc.cliente.nome,
    status: "CANCELADO",
  });
  return obterRma(user, id);
}
