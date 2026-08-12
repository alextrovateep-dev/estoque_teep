import {
  RMA_ITEM_ETAPAS_SAIDA,
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
  notificarRmaLaudos,
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
  responsavelComercial: { select: { id: true, nome: true, email: true } },
  destinatarios: {
    select: {
      id: true,
      origem: true,
      usuario: { select: { id: true, nome: true, email: true, ativo: true } },
    },
    orderBy: { criadoEm: "asc" as const },
  },
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
      aprovacaoPor: { select: { id: true, nome: true } },
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
  return { ...mov, id: mov.id };
}

function assertPodeVerProcesso(user: AuthUser, filialId: string) {
  if (user.perfil === "OPERADOR") {
    assertOperadorPodeFilial(user, filialId);
  }
}

function assertEtapaPermiteSaida(etapa: string | null | undefined) {
  if (
    !(RMA_ITEM_ETAPAS_SAIDA as readonly string[]).includes(etapa || "")
  ) {
    throw new AppError(
      400,
      "Item ainda não está liberado para envio (aguarde aprovação e, se aprovado, a manutenção)"
    );
  }
}

function itemTemLaudoAtivo(item: {
  anexos?: Array<{ tipo: string; ativo?: boolean | null }>;
}): boolean {
  return (item.anexos || []).some(
    (a) => a.tipo === "LAUDO" && a.ativo !== false
  );
}

async function assertUsuarioComercialAtivo(usuarioId: string) {
  const u = await prisma.usuario.findFirst({
    where: { id: usuarioId, ativo: true },
    select: { id: true, nome: true },
  });
  if (!u) {
    throw new AppError(400, "Responsável comercial inválido ou inativo");
  }
  return u;
}

function podeDecidirAprovacao(
  user: AuthUser,
  responsavelComercialId: string | null | undefined
) {
  if (user.perfil === "ADMIN" || user.perfil === "GERENTE") return true;
  return Boolean(responsavelComercialId && user.id === responsavelComercialId);
}


function destinatarioIdsDoProcesso(proc: {
  destinatarios?: Array<{ usuario: { id: string } }>;
  criadoPor?: { id: string };
  criadoPorId?: string;
}): string[] {
  const ids = (proc.destinatarios || []).map((d) => d.usuario.id);
  if (ids.length > 0) return ids;
  const criador = proc.criadoPor?.id || proc.criadoPorId;
  return criador ? [criador] : [];
}

async function listarIdsComTickRmaAberto(): Promise<string[]> {
  const users = await prisma.usuario.findMany({
    where: { ativo: true },
    select: { id: true, alertasEmail: true },
  });
  return users
    .filter((u) => {
      const prefs =
        u.alertasEmail && typeof u.alertasEmail === "object"
          ? (u.alertasEmail as Record<string, boolean>)
          : {};
      return prefs.RMA_ABERTO === true;
    })
    .map((u) => u.id);
}

export async function listarDestinatariosPadraoRma() {
  const users = await prisma.usuario.findMany({
    where: { ativo: true },
    select: {
      id: true,
      nome: true,
      email: true,
      alertasEmail: true,
    },
    orderBy: { nome: "asc" },
  });
  return users
    .filter((u) => {
      const prefs =
        u.alertasEmail && typeof u.alertasEmail === "object"
          ? (u.alertasEmail as Record<string, boolean>)
          : {};
      return prefs.RMA_ABERTO === true;
    })
    .map(({ id, nome, email }) => ({ id, nome, email }));
}

export async function listarUsuariosParaDestinatarioRma() {
  return prisma.usuario.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, email: true },
    orderBy: { nome: "asc" },
  });
}

async function gravarDestinatariosRma(
  processoId: string,
  destinatarioIds: string[],
  criadorId: string
) {
  let ids = [...new Set(destinatarioIds.filter(Boolean))];
  if (ids.length === 0) ids.push(criadorId);
  const ativos = await prisma.usuario.findMany({
    where: { id: { in: ids }, ativo: true },
    select: { id: true },
  });
  const ok = new Set(ativos.map((a) => a.id));
  if (ok.size === 0) ok.add(criadorId);
  const globais = new Set(await listarIdsComTickRmaAberto());
  await prisma.rmaDestinatario.deleteMany({ where: { processoId } });
  await prisma.rmaDestinatario.createMany({
    data: [...ok].map((usuarioId) => ({
      processoId,
      usuarioId,
      origem: globais.has(usuarioId) ? "GLOBAL" : "MANUAL",
    })),
  });
  return [...ok];
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
        criadoPorId: true,
        cliente: { select: { nome: true } },
        destinatarios: {
          select: { usuario: { select: { id: true } } },
        },
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
      destinatarioIds: destinatarioIdsDoProcesso(before),
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
        responsavelComercial: { select: { id: true, nome: true } },
        itens: {
          select: { id: true, status: true, etapa: true, cobrou: true },
        },
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
    responsavelComercialId: string;
    observacao?: string | null;
    nfEntradaNumero?: string | null;
    nfEntradaArquivo?: string | null;
    destinatarioIds?: string[];
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
  if (cliente.tipo === "FORNECEDOR") {
    throw new AppError(400, "Selecione um cliente (não fornecedor)");
  }

  await assertUsuarioComercialAtivo(input.responsavelComercialId);

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
      responsavelComercialId: input.responsavelComercialId,
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
          etapa: "AGUARDANDO_LAUDO",
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

  const destIds = await gravarDestinatariosRma(
    processo.id,
    input.destinatarioIds || [],
    user.id
  );
  const itensResumo = linhas.map(
    (l) => `${l.codigo} / S/N ${l.series[0]}`
  );
  notificarRmaAberto({
    processoId: processo.id,
    clienteNome: cliente.nome,
    qtdItens: linhas.length,
    criadoPorNome: user.nome,
    destinatarioIds: destIds,
    nfEntradaNumero: input.nfEntradaNumero,
    itensResumo,
  });

  return obterRma(user, processo.id);
}

export async function atualizarRmaCliente(
  user: AuthUser,
  id: string,
  input: { clienteId: string }
) {
  const proc = await obterRma(user, id);
  if (proc.status !== "ABERTO") {
    throw new AppError(400, "Só é possível alterar o cliente em RMA aberto");
  }
  const jaExpedido = proc.itens.some((i) =>
    ["DEVOLVIDO", "DESCARTADO"].includes(i.status)
  );
  if (jaExpedido) {
    throw new AppError(
      400,
      "Já houve devolução ou troca neste RMA — não é possível trocar o cliente"
    );
  }

  const cliente = await prisma.cliente.findFirst({
    where: { id: input.clienteId, ativo: true },
  });
  if (!cliente) throw new AppError(400, "Cliente inválido");
  if (cliente.tipo === "FORNECEDOR") {
    throw new AppError(400, "Selecione um cliente (não fornecedor)");
  }
  if (cliente.id === proc.clienteId) {
    return obterRma(user, id);
  }

  // Só itens ainda no RMA — não reescrever entradas já estornadas (CANCELADO)
  const itensNoRma = proc.itens.filter((i) =>
    (ITEM_NO_RMA as readonly string[]).includes(i.status)
  );
  const movIds = itensNoRma
    .map((i) => i.movEntradaId)
    .filter((x): x is string => Boolean(x));
  const serieIds = itensNoRma
    .map((i) => i.unidadeSerie?.id)
    .filter((x): x is string => Boolean(x));

  await prisma.$transaction(async (tx) => {
    await tx.rmaProcesso.update({
      where: { id },
      data: { clienteId: cliente.id },
    });
    if (movIds.length > 0) {
      await tx.movimentacao.updateMany({
        where: { id: { in: movIds } },
        data: { clienteId: cliente.id },
      });
    }
    if (serieIds.length > 0) {
      await tx.unidadeSerie.updateMany({
        where: { id: { in: serieIds } },
        data: { clienteId: cliente.id },
      });
    }
  });

  return obterRma(user, id);
}

export async function atualizarRmaComercial(
  user: AuthUser,
  id: string,
  input: { responsavelComercialId: string }
) {
  const proc = await obterRma(user, id);
  if (proc.status !== "ABERTO") {
    throw new AppError(400, "Só é possível alterar o comercial em RMA aberto");
  }
  const aindaPendentes = proc.itens.some((i) =>
    ["AGUARDANDO_LAUDO", "AGUARDANDO_APROVACAO"].includes(i.etapa || "")
  );
  if (!aindaPendentes) {
    throw new AppError(
      400,
      "Todos os itens já foram decididos — não é possível trocar o responsável comercial"
    );
  }
  await assertUsuarioComercialAtivo(input.responsavelComercialId);
  await prisma.rmaProcesso.update({
    where: { id },
    data: { responsavelComercialId: input.responsavelComercialId },
  });
  return obterRma(user, id);
}

async function aplicarAprovacaoItem(
  user: AuthUser,
  processoId: string,
  itemId: string,
  input: { decisao: "APROVADA" | "RECUSADA"; observacao?: string | null }
) {
  const etapa =
    input.decisao === "APROVADA" ? "AGUARDANDO_MANUTENCAO" : "NAO_APROVADO";
  const data: {
    etapa: string;
    aprovacaoEm: Date;
    aprovacaoPorId: string;
    aprovacaoObs: string | null;
    status?: string;
  } = {
    etapa,
    aprovacaoEm: new Date(),
    aprovacaoPorId: user.id,
    aprovacaoObs: input.observacao?.trim() || null,
  };
  if (input.decisao === "RECUSADA") {
    data.status = "SEM_MANUTENCAO";
  }
  const claim = await prisma.rmaItem.updateMany({
    where: {
      id: itemId,
      processoId,
      etapa: "AGUARDANDO_APROVACAO",
    },
    data,
  });
  if (claim.count === 0) {
    throw new AppError(
      409,
      "Item não está aguardando aprovação — atualize a tela"
    );
  }
}

export async function registrarAprovacaoManutencaoRmaItem(
  user: AuthUser,
  processoId: string,
  itemId: string,
  input: { decisao: "APROVADA" | "RECUSADA"; observacao?: string | null }
) {
  const proc = await obterRma(user, processoId);
  if (proc.status !== "ABERTO") {
    throw new AppError(400, "Só é possível decidir em RMA aberto");
  }
  if (!podeDecidirAprovacao(user, proc.responsavelComercialId)) {
    throw new AppError(
      403,
      "Apenas o responsável comercial (ou Gerente/Admin) pode registrar a decisão"
    );
  }
  const item = proc.itens.find((i) => i.id === itemId);
  if (!item) throw new AppError(404, "Item não encontrado neste processo");
  if (item.etapa !== "AGUARDANDO_APROVACAO") {
    throw new AppError(
      400,
      "Só itens em aguardando aprovação podem ser decididos"
    );
  }
  await aplicarAprovacaoItem(user, processoId, itemId, input);
  return obterRma(user, processoId);
}

export async function marcarManutencaoRealizadaRmaItem(
  user: AuthUser,
  processoId: string,
  itemId: string
) {
  const proc = await obterRma(user, processoId);
  if (proc.status !== "ABERTO") {
    throw new AppError(400, "Só é possível marcar manutenção em RMA aberto");
  }
  const item = proc.itens.find((i) => i.id === itemId);
  if (!item) throw new AppError(404, "Item não encontrado neste processo");
  if (item.etapa !== "AGUARDANDO_MANUTENCAO") {
    throw new AppError(
      400,
      "Só itens aprovados (aguardando manutenção) podem ser marcados"
    );
  }
  const claim = await prisma.rmaItem.updateMany({
    where: {
      id: itemId,
      processoId,
      etapa: "AGUARDANDO_MANUTENCAO",
    },
    data: { etapa: "AGUARDANDO_ENVIO" },
  });
  if (claim.count === 0) {
    throw new AppError(409, "Item já foi atualizado — atualize a tela");
  }
  return obterRma(user, processoId);
}

export async function atualizarRmaItemFinanceiro(
  user: AuthUser,
  processoId: string,
  itemId: string,
  input: {
    cobrou?: boolean | null;
    valorCobrado?: number | null;
    nfCobrancaNumero?: string | null;
  }
) {
  const proc = await obterRma(user, processoId);
  if (proc.status === "CANCELADO") {
    throw new AppError(400, "Processo cancelado — não é possível alterar cobrança");
  }
  const item = proc.itens.find((i) => i.id === itemId);
  if (!item) throw new AppError(404, "Item não encontrado neste processo");
  if (item.status === "CANCELADO") {
    throw new AppError(400, "Item cancelado — cobrança indisponível");
  }

  const cobrou = input.cobrou === undefined ? item.cobrou : input.cobrou;
  const data: Record<string, unknown> = {};
  if (input.cobrou !== undefined) data.cobrou = input.cobrou;

  if (cobrou === true) {
    const valor =
      input.valorCobrado !== undefined
        ? input.valorCobrado
        : item.valorCobrado != null
          ? Number(item.valorCobrado)
          : null;
    const nfCob =
      input.nfCobrancaNumero !== undefined
        ? input.nfCobrancaNumero?.trim() || null
        : item.nfCobrancaNumero;
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
  } else {
    if (input.valorCobrado !== undefined) data.valorCobrado = input.valorCobrado;
    if (input.nfCobrancaNumero !== undefined) {
      data.nfCobrancaNumero = input.nfCobrancaNumero?.trim() || null;
    }
  }

  await prisma.rmaItem.update({ where: { id: itemId }, data });
  const atualizado = await obterRma(user, processoId);
  const itemAtual = atualizado.itens.find((i) => i.id === itemId);
  notificarRmaFinanceiro({
    processoId,
    clienteNome: atualizado.cliente.nome,
    cobrou: Boolean(itemAtual?.cobrou),
    valorCobrado:
      itemAtual?.valorCobrado != null ? Number(itemAtual.valorCobrado) : null,
    nfCobrancaNumero: itemAtual?.nfCobrancaNumero ?? null,
    destinatarioIds: destinatarioIdsDoProcesso(atualizado),
  });
  return atualizado;
}

export async function adicionarRmaItens(
  user: AuthUser,
  id: string,
  input: {
    produtoId: string;
    series: string[];
    observacao?: string | null;
  }
) {
  const proc = await obterRma(user, id);
  if (proc.status !== "ABERTO") {
    throw new AppError(400, "Só é possível adicionar itens em RMA aberto");
  }

  const produto = await prisma.produto.findFirst({
    where: { id: input.produtoId, ativo: true },
  });
  if (!produto) throw new AppError(400, "Produto inválido");
  if (!produto.controlaSerie) {
    throw new AppError(
      400,
      `Produto ${produto.codigo} precisa controlar número de série para RMA`
    );
  }

  const series = (input.series || []).map((s) => s.trim()).filter(Boolean);
  if (series.length === 0) {
    throw new AppError(400, "Informe o número de série");
  }

  const ativas = proc.itens.filter((i) =>
    ["ABERTO", "EM_ESTOQUE", "SEM_MANUTENCAO", "DEVOLVIDO", "DESCARTADO"].includes(
      i.status
    )
  );
  if (ativas.length + series.length > 50) {
    throw new AppError(400, "Máximo de 50 itens por processo RMA");
  }

  // Qualquer item não-cancelado do processo (evita reincluir série já devolvida/trocada)
  const existentes = new Set(
    proc.itens
      .filter((i) => i.status !== "CANCELADO")
      .map((i) =>
        `${i.produtoId}::${(i.unidadeSerie?.numeroSerie || "").toLowerCase()}`
      )
      .filter((k) => !k.endsWith("::"))
  );
  const vistas = new Set<string>();
  for (const sn of series) {
    const key = `${produto.id}::${sn.toLowerCase()}`;
    if (vistas.has(key) || existentes.has(key)) {
      throw new AppError(
        400,
        `Número de série duplicado no RMA: ${produto.codigo} / ${sn}`
      );
    }
    vistas.add(key);
  }

  const tipoEntrada = await tipoPorNome(TIPO_ENTRADA_RMA);
  const nfEntradaArquivo = await arquivoAnexoAtivo(id, "NF_ENTRADA");
  const feitos: Array<{ movEntradaId: string; itemId?: string }> = [];

  try {
    for (const sn of series) {
      const result = await criarMovimentacao(user, {
        tipoId: tipoEntrada.id,
        produtoId: produto.id,
        filialId: proc.filialId,
        clienteId: proc.clienteId,
        quantidade: 1,
        series: [sn],
        notaFiscalNumero: proc.nfEntradaNumero,
        notaFiscalArquivo: nfEntradaArquivo,
        permitirReativarSaido: true,
        observacao: `RMA ${id.slice(0, 8)} (item incluído)${
          input.observacao ? ` — ${input.observacao}` : ""
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
              produtoId: produto.id,
              numeroSerie: { equals: sn, mode: "insensitive" },
            },
            select: { id: true },
          })
        )?.id ||
        null;

      if (!unidadeSerieId) {
        throw new AppError(
          500,
          `Entrada RMA sem vínculo de série (${produto.codigo} / ${sn})`
        );
      }

      const item = await prisma.rmaItem.create({
        data: {
          processoId: id,
          produtoId: produto.id,
          unidadeSerieId,
          quantidade: 1,
          status: "EM_ESTOQUE",
          etapa: "AGUARDANDO_LAUDO",
          movEntradaId: mov.id,
          observacao: input.observacao?.trim() || null,
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
          `Rollback inclusão RMA ${id.slice(0, 8)}`,
          { bypassPerfil: true }
        );
        if (f.itemId) {
          await prisma.rmaItem.delete({ where: { id: f.itemId } }).catch(() => {
            /* já removido */
          });
        }
      } catch (comp) {
        falhasComp.push(f.movEntradaId);
        console.error("[rma] falha compensação inclusão item", id, comp);
      }
    }
    if (falhasComp.length > 0) {
      const orig = e instanceof Error ? e.message : "Falha ao incluir item no RMA";
      throw new AppError(
        500,
        `${orig}. Rollback incompleto (${falhasComp.length} entrada(s) sem estorno) — confira o estoque RMA e as movimentações.`
      );
    }
    if (e instanceof AppError) throw e;
    throw new AppError(
      400,
      e instanceof Error ? e.message : "Falha ao incluir item no RMA"
    );
  }

  return obterRma(user, id);
}

export async function removerRmaItem(
  user: AuthUser,
  id: string,
  itemId: string,
  input: { observacao: string }
) {
  const proc = await obterRma(user, id);
  if (proc.status !== "ABERTO") {
    throw new AppError(400, "Só é possível remover itens de RMA aberto");
  }
  assertPodeVerProcesso(user, proc.filialId);

  const item = proc.itens.find((i) => i.id === itemId);
  if (!item) throw new AppError(404, "Item não encontrado neste RMA");
  if (!(ITEM_NO_RMA as readonly string[]).includes(item.status)) {
    throw new AppError(
      400,
      "Só é possível remover itens ainda no Estoque RMA (estorna a entrada)"
    );
  }
  if (!item.movEntradaId) {
    throw new AppError(400, "Item sem movimentação de entrada");
  }

  const obs = input.observacao.trim();
  if (!obs) {
    throw new AppError(400, "Informe o motivo da remoção");
  }

  // Escopo: só estorna a entrada vinculada a este item (bypass não abre estorno genérico)
  const movEntrada = await prisma.movimentacao.findFirst({
    where: {
      id: item.movEntradaId,
      status: "CONCLUIDO",
      tipo: { nome: TIPO_ENTRADA_RMA },
    },
    select: { id: true },
  });
  if (!movEntrada) {
    throw new AppError(
      400,
      "Entrada RMA do item inválida ou já estornada — atualize a tela"
    );
  }

  const notaEstorno = notaRmaComObs(
    `Remoção item RMA ${id.slice(0, 8)}`,
    obs
  );
  const sn = item.unidadeSerie?.numeroSerie?.trim();
  const linhaAudit = `Removido ${item.produto.codigo}${
    sn ? ` S/N ${sn}` : ""
  }: ${obs}`;
  const observacaoProcesso = proc.observacao?.trim()
    ? `${proc.observacao.trim()}\n${linhaAudit}`
    : linhaAudit;

  const claim = await prisma.rmaItem.updateMany({
    where: {
      id: item.id,
      status: { in: [...ITEM_NO_RMA] },
    },
    data: {
      status: "CANCELADO",
      etapa: "FINALIZADO",
      observacao: item.observacao?.trim()
        ? `${item.observacao.trim()}\nRemovido: ${obs}`
        : `Removido: ${obs}`,
    },
  });
  if (claim.count === 0) {
    throw new AppError(
      409,
      "Item já foi movimentado — atualize a tela e tente de novo"
    );
  }

  try {
    await estornarMovimentacao(user, item.movEntradaId, notaEstorno, {
      bypassPerfil: true,
    });
  } catch (inner) {
    await prisma.rmaItem.update({
      where: { id: item.id },
      data: {
        status:
          item.status === "SEM_MANUTENCAO" ? "SEM_MANUTENCAO" : "EM_ESTOQUE",
        etapa: item.etapa || "AGUARDANDO_LAUDO",
        observacao: item.observacao,
      },
    });
    throw inner;
  }

  await prisma.rmaProcesso.update({
    where: { id },
    data: { observacao: observacaoProcesso },
  });

  // Fecha só se já houve devolução/troca e não restou pendência
  const pendentes = await prisma.rmaItem.count({
    where: {
      processoId: id,
      status: { in: ["ABERTO", "EM_ESTOQUE", "SEM_MANUTENCAO"] },
    },
  });
  if (pendentes === 0) {
    const concluidos = await prisma.rmaItem.count({
      where: {
        processoId: id,
        status: { in: ["DEVOLVIDO", "DESCARTADO"] },
      },
    });
    if (concluidos > 0) {
      await maybeFecharProcesso(id);
    }
  }

  return obterRma(user, id);
}

/** NFs / observação do processo. Cobrança de manutenção é por item. */
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

  const data: Record<string, unknown> = {};
  if (input.nfEntradaNumero !== undefined) {
    data.nfEntradaNumero = input.nfEntradaNumero?.trim() || null;
  }
  if (input.nfSaidaNumero !== undefined) {
    data.nfSaidaNumero = input.nfSaidaNumero?.trim() || null;
  }
  if (input.observacao !== undefined) {
    data.observacao = input.observacao?.trim() || null;
  }
  // Compat: ainda aceita cobrança no processo, mas a UI usa o item
  if (input.cobrou !== undefined) data.cobrou = input.cobrou;
  if (input.valorCobrado !== undefined) data.valorCobrado = input.valorCobrado;
  if (input.nfCobrancaNumero !== undefined) {
    data.nfCobrancaNumero = input.nfCobrancaNumero?.trim() || null;
  }

  if (Object.keys(data).length === 0) {
    return obterRma(user, id);
  }

  await prisma.rmaProcesso.update({ where: { id }, data });
  return obterRma(user, id);
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
  if (proc.status === "CANCELADO") {
    throw new AppError(400, "Processo cancelado — não é possível anexar");
  }

  const tipo = input.tipo as RmaAnexoTipo;
  // NF retorno (entrada/saída) e laudos: só com RMA aberto.
  // NF cobrança: financeiro pode anexar também após FECHADO.
  if (proc.status === "FECHADO" && tipo !== "NF_COBRANCA") {
    throw new AppError(
      400,
      "Processo fechado — só a NF de cobrança pode ser anexada pelo financeiro"
    );
  }

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

function notaRmaComObs(prefixo: string, observacao?: string | null) {
  const obs = observacao?.trim();
  return obs ? `${prefixo} — ${obs}` : prefixo;
}

export async function devolverRmaItens(
  user: AuthUser,
  id: string,
  input: {
    itemIds?: string[];
    nfSaidaNumero?: string | null;
    observacao?: string | null;
  }
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

  let itens = proc.itens.filter(
    (i) =>
      (ITEM_NO_RMA as readonly string[]).includes(i.status) &&
      (RMA_ITEM_ETAPAS_SAIDA as readonly string[]).includes(i.etapa || "")
  );
  if (input.itemIds?.length) {
    const set = new Set(input.itemIds);
    const pedidos = proc.itens.filter((i) => set.has(i.id));
    for (const p of pedidos) {
      if (!(ITEM_NO_RMA as readonly string[]).includes(p.status)) {
        throw new AppError(
          400,
          `Item ${p.produto.codigo} não está no estoque RMA`
        );
      }
      assertEtapaPermiteSaida(p.etapa);
    }
    itens = pedidos;
  }
  if (itens.length === 0) {
    throw new AppError(
      400,
      "Nenhum item liberado para devolução (aprovação + manutenção, se aplicável)"
    );
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
    etapaAnterior: string;
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
      const etapaAnterior = item.etapa || "AGUARDANDO_ENVIO";
      // Claim otimista: só um request pode pegar o item ainda no RMA
      const claim = await prisma.rmaItem.updateMany({
        where: {
          id: item.id,
          status: { in: [...ITEM_NO_RMA] },
          etapa: { in: [...RMA_ITEM_ETAPAS_SAIDA] },
        },
        data: { status: "DEVOLVIDO", etapa: "FINALIZADO" },
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
          observacao: notaRmaComObs(
            `Devolução RMA ${id.slice(0, 8)}`,
            input.observacao
          ),
        });
        saidaOk = true;
        movSaidaId = mov.id;
        feitos.push({
          itemId: item.id,
          movSaidaId: mov.id,
          statusAnterior,
          etapaAnterior,
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
              etapa: etapaAnterior,
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
          data: {
            status: f.statusAnterior,
            etapa: f.etapaAnterior,
            movSaidaId: null,
          },
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
  assertEtapaPermiteSaida(item.etapa);
  if (!(ITEM_NO_RMA as readonly string[]).includes(item.status)) {
    throw new AppError(400, "Só itens ainda no estoque RMA podem ser trocados");
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
  const etapaAnterior = item.etapa || "AGUARDANDO_ENVIO";

  const claim = await prisma.rmaItem.updateMany({
    where: {
      id: item.id,
      status: { in: [...ITEM_NO_RMA] },
      etapa: { in: [...RMA_ITEM_ETAPAS_SAIDA] },
    },
    data: {
      status: "DESCARTADO",
      etapa: "FINALIZADO",
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
        etapa: etapaAnterior,
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

export async function cancelarRma(
  user: AuthUser,
  id: string,
  input: { observacao: string }
) {
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

  const motivo = input.observacao.trim();
  if (!motivo) {
    throw new AppError(400, "Informe o motivo do cancelamento");
  }
  if (user.perfil === "OPERADOR") {
    throw new AppError(
      403,
      "Só Gerente/Admin pode cancelar o RMA. Corrija cliente ou remova/inclua itens; se precisar cancelar, peça ao gerente."
    );
  }
  const notaEstorno = notaRmaComObs(
    `Cancelamento RMA ${id.slice(0, 8)}`,
    motivo
  );
  const motivoProcesso = `Cancelamento: ${motivo}`;
  const observacaoProcesso = proc.observacao?.trim()
    ? `${proc.observacao.trim()}\n${motivoProcesso}`
    : motivoProcesso;

  const emEstoque = proc.itens.filter((i) =>
    (ITEM_NO_RMA as readonly string[]).includes(i.status)
  );

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
        data: { status: "CANCELADO", etapa: "FINALIZADO" },
      });
      if (claim.count === 0) {
        throw new AppError(
          409,
          `Item ${item.produto.codigo} já foi movimentado — atualize a tela e tente de novo`
        );
      }

      try {
        await estornarMovimentacao(user, item.movEntradaId, notaEstorno, {
          bypassPerfil: true,
        });
        cancelados += 1;
      } catch (inner) {
        await prisma.rmaItem.update({
          where: { id: item.id },
          data: {
            status:
              item.status === "SEM_MANUTENCAO" ? "SEM_MANUTENCAO" : "EM_ESTOQUE",
            etapa: item.etapa || "AGUARDANDO_LAUDO",
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
        data: { status: "CANCELADO", observacao: observacaoProcesso },
      });
      notificarRmaEncerrado({
        processoId: id,
        clienteNome: proc.cliente.nome,
        status: "CANCELADO",
        destinatarioIds: destinatarioIdsDoProcesso(proc),
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
    data: { status: "CANCELADO", observacao: observacaoProcesso },
  });
  notificarRmaEncerrado({
        processoId: id,
        clienteNome: proc.cliente.nome,
        status: "CANCELADO",
        destinatarioIds: destinatarioIdsDoProcesso(proc),
      });
  return obterRma(user, id);
}


export async function atualizarRmaDestinatarios(
  user: AuthUser,
  id: string,
  input: { destinatarioIds: string[] }
) {
  const proc = await obterRma(user, id);
  if (proc.status !== "ABERTO") {
    throw new AppError(400, "Só é possível alterar destinatários em RMA aberto");
  }
  await gravarDestinatariosRma(id, input.destinatarioIds, user.id);
  return obterRma(user, id);
}

export async function notificarLaudosRma(user: AuthUser, id: string) {
  const proc = await obterRma(user, id);
  if (proc.status === "CANCELADO" || proc.status === "FECHADO") {
    throw new AppError(
      400,
      `Processo ${proc.status === "CANCELADO" ? "cancelado" : "fechado"} — não é possível notificar laudos`
    );
  }
  const destIds = [
    ...new Set(
      [
        ...destinatarioIdsDoProcesso(proc),
        proc.responsavelComercialId,
        proc.responsavelComercial?.id,
      ].filter((x): x is string => Boolean(x))
    ),
  ];
  if (destIds.length === 0) {
    throw new AppError(400, "Nenhum destinatário neste RMA");
  }
  const laudos = (proc.anexos || []).filter(
    (a) => a.tipo === "LAUDO" && a.ativo !== false
  );
  const laudosItens = (proc.itens || []).flatMap((i) =>
    (i.anexos || [])
      .filter((a) => a.tipo === "LAUDO" && a.ativo !== false)
      .map((a) => ({ item: i, anexo: a }))
  );
  const todos = [
    ...laudos.map((a) => ({ item: null as (typeof proc.itens)[0] | null, anexo: a })),
    ...laudosItens,
  ];
  // dedupe by anexo id
  const seen = new Set<string>();
  const unicos = todos.filter(({ anexo }) => {
    if (seen.has(anexo.id)) return false;
    seen.add(anexo.id);
    return true;
  });
  if (unicos.length === 0) {
    throw new AppError(400, "Nenhum laudo ativo para notificar");
  }
  const appUrl =
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    "http://localhost:3000";
  const laudosResumo = unicos.map(({ item, anexo }) => {
    const prod = item
      ? `${item.produto.codigo}${
          item.unidadeSerie ? ` S/N ${item.unidadeSerie.numeroSerie}` : ""
        }`
      : "processo";
    const label = anexo.label || "Laudo";
    return `${prod} — ${label} (ver em ${appUrl}/rma/${id})`;
  });
  notificarRmaLaudos({
    processoId: id,
    clienteNome: proc.cliente.nome,
    destinatarioIds: destIds,
    laudosResumo,
  });

  // Avança itens com laudo ativo ainda em AGUARDANDO_LAUDO
  const itemIdsComLaudo = new Set(
    unicos
      .map(({ item, anexo }) => item?.id || anexo.itemId)
      .filter((x): x is string => Boolean(x))
  );
  // Laudos sem itemId no anexo de processo não avançam itens
  for (const it of proc.itens) {
    if (it.etapa !== "AGUARDANDO_LAUDO") continue;
    if (!itemTemLaudoAtivo(it) && !itemIdsComLaudo.has(it.id)) continue;
    await prisma.rmaItem.updateMany({
      where: {
        id: it.id,
        processoId: id,
        etapa: "AGUARDANDO_LAUDO",
      },
      data: { etapa: "AGUARDANDO_APROVACAO" },
    });
  }

  return { ok: true, qtdLaudos: unicos.length, qtdDestinatarios: destIds.length };
}

