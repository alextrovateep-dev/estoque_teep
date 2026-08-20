import {
  RMA_ITEM_ETAPA,
  RMA_ITEM_ETAPAS_SAIDA,
  SIGLA_ESTOQUE_RMA,
  emailsAlertaDeUsuariosRma,
  mensagemBloqueioNfRetorno,
  mensagemBloqueioNfRetornoSemEntrada,
  parseYmd,
} from "@teep/shared";
import { prisma } from "../lib/prisma";
import { produtoTemChecklistAtivo } from "../lib/rmaChecklist";
import {
  assertNotaFiscalNumeroLivre,
  mesmaNotaFiscalNumero,
} from "../lib/notaFiscalNumero";
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
import {
  criarMovimentacao,
  estornarMovimentacao,
  rejeitarMovimentacao,
} from "./movimentacaoService";
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
  criadoPor: { select: { id: true, nome: true, email: true } },
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
      checklistExecucoes: {
        include: {
          template: {
            include: { itens: { orderBy: { ordem: "asc" as const } } },
          },
          respostas: true,
          preenchidoPor: { select: { id: true, nome: true } },
        },
      },
      diagnostico: true,
      manutencaoPlano: {
        include: {
          servicos: { orderBy: { ordem: "asc" as const } },
          pecas: {
            include: {
              produto: {
                select: {
                  id: true,
                  codigo: true,
                  descricao: true,
                  precoUnitario: true,
                },
              },
            },
          },
        },
      },
      orcamento: {
        include: {
          linhas: {
            include: {
              produto: {
                select: {
                  id: true,
                  codigo: true,
                  descricao: true,
                  precoUnitario: true,
                },
              },
            },
            orderBy: { id: "asc" as const },
          },
          aprovadoPor: { select: { id: true, nome: true } },
        },
      },
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

/** Tipo ENTRADA marcado para entrada automática do RMA (flag no cadastro). */
async function tipoEntradaRma() {
  const t = await prisma.tipoMovimentacao.findFirst({
    where: {
      rmaEntradaEstoque: true,
      operacao: "ENTRADA",
      ativo: true,
    },
  });
  if (!t) {
    throw new AppError(
      400,
      "Nenhum tipo de entrada marcado para RMA. Em Admin → Tipos, ative «RMA: entrada automática no estoque» em um tipo ENTRADA."
    );
  }
  return t;
}

/** Tipo SAIDA marcado para devolver/trocar no RMA. */
async function tipoSaidaRma() {
  const t = await prisma.tipoMovimentacao.findFirst({
    where: {
      rmaSaidaCliente: true,
      operacao: "SAIDA",
      ativo: true,
    },
  });
  if (!t) {
    throw new AppError(
      400,
      "Nenhum tipo de saída marcado para RMA. Em Admin → Tipos, ative «RMA: saída ao devolver/trocar» em um tipo SAÍDA."
    );
  }
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
    alertaEmails?: string[];
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
    alertaEmails: opts.alertaEmails,
    usoInternoRma: true,
  });
  const mov = result.movimentacao;
  if (!mov?.id || mov.status === "PENDENTE") {
    throw new AppError(400, "Falha ao lançar saída RMA");
  }
  return { ...mov, id: mov.id };
}

type EntradaRmaFeita = { movEntradaId: string; itemId?: string };

async function desfazerMovimentacaoEntradaRma(
  user: AuthUser,
  movId: string,
  status: string,
  motivo: string
) {
  if (status === "PENDENTE") {
    await rejeitarMovimentacao(user, movId, motivo, { bypassPerfil: true });
    return;
  }
  if (status === "CONCLUIDO") {
    await estornarMovimentacao(user, movId, motivo, { bypassPerfil: true });
  }
}

/** Entrada no Estoque RMA + item do processo (abertura e inclusão). */
async function lancarEntradaSerieRma(
  user: AuthUser,
  opts: {
    processoId: string;
    tipoEntradaId: string;
    produtoId: string;
    produtoCodigo: string;
    filialId: string;
    clienteId: string;
    numeroSerie: string;
    notaFiscalNumero?: string | null;
    notaFiscalArquivo?: string | null;
    observacaoItem?: string | null;
    observacaoMov: string;
  }
): Promise<EntradaRmaFeita> {
  const result = await criarMovimentacao(user, {
    tipoId: opts.tipoEntradaId,
    produtoId: opts.produtoId,
    filialId: opts.filialId,
    clienteId: opts.clienteId,
    quantidade: 1,
    series: [opts.numeroSerie],
    notaFiscalNumero: opts.notaFiscalNumero ?? null,
    notaFiscalArquivo: opts.notaFiscalArquivo ?? null,
    permitirReativarSaido: true,
    usoInternoRma: true,
    observacao: opts.observacaoMov,
  });

  const mov = result.movimentacao;
  const movId = mov?.id;
  const movStatus = mov?.status;
  const rotulo = `${opts.produtoCodigo} / S/N ${opts.numeroSerie}`;
  const motivoUndo = `Rollback entrada RMA ${opts.processoId.slice(0, 8)} (${rotulo})`;

  const desfazerSeCriou = async () => {
    if (!movId || !movStatus) return;
    await desfazerMovimentacaoEntradaRma(user, movId, movStatus, motivoUndo);
  };

  try {
    if (result.fluxo && result.fluxo !== "LANCAMENTO") {
      throw new AppError(
        400,
        `Não foi possível dar entrada de ${rotulo} no Estoque RMA.`
      );
    }
    if (!movId) throw new AppError(500, "Entrada RMA sem movimentação");
    if (movStatus === "PENDENTE") {
      throw new AppError(
        400,
        "A entrada ficou pendente de aprovação. Em Admin → Tipos, no tipo de entrada RMA, desative a exigência de aprovação."
      );
    }

    const serieDaMov =
      mov && "series" in mov ? mov.series?.[0]?.unidadeSerie?.id : undefined;
    const unidadeSerieId =
      serieDaMov ||
      (
        await prisma.unidadeSerie.findFirst({
          where: {
            produtoId: opts.produtoId,
            numeroSerie: { equals: opts.numeroSerie, mode: "insensitive" },
          },
          select: { id: true },
        })
      )?.id ||
      null;

    if (!unidadeSerieId) {
      throw new AppError(500, `Entrada RMA sem vínculo de série (${rotulo})`);
    }

    const item = await prisma.rmaItem.create({
      data: {
        processoId: opts.processoId,
        produtoId: opts.produtoId,
        unidadeSerieId,
        quantidade: 1,
        status: "EM_ESTOQUE",
        etapa: "AGUARDANDO_RECEBIMENTO",
        movEntradaId: movId,
        observacao: opts.observacaoItem?.trim() || null,
      },
    });
    return { movEntradaId: movId, itemId: item.id };
  } catch (e) {
    try {
      await desfazerSeCriou();
    } catch (undoErr) {
      console.error(
        "[rma] falha ao desfazer entrada após erro",
        movId,
        undoErr
      );
      throw new AppError(
        500,
        `Falha ao concluir a entrada RMA de ${rotulo} e ao desfazer a movimentação. Confira o estoque RMA.`
      );
    }
    throw e;
  }
}

async function compensarEntradasRma(
  user: AuthUser,
  feitos: EntradaRmaFeita[],
  motivo: string
): Promise<string[]> {
  const falhas: string[] = [];
  for (const f of [...feitos].reverse()) {
    try {
      await estornarMovimentacao(user, f.movEntradaId, motivo, {
        bypassPerfil: true,
      });
      if (f.itemId) {
        await prisma.rmaItem.delete({ where: { id: f.itemId } }).catch(() => {
          /* já removido */
        });
      }
    } catch (compErr) {
      falhas.push(f.movEntradaId);
      console.error("[rma] falha ao compensar entrada", f.movEntradaId, compErr);
    }
  }
  return falhas;
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
      "Item ainda não está liberado para envio (conclua orçamento/aprovação, manutenção e checklist de liberação)"
    );
  }
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

export function podeDecidirAprovacaoRma(
  user: AuthUser,
  responsavelComercialId: string | null | undefined
) {
  if (user.perfil === "ADMIN" || user.perfil === "GERENTE") return true;
  return Boolean(responsavelComercialId && user.id === responsavelComercialId);
}

function podeDecidirAprovacao(
  user: AuthUser,
  responsavelComercialId: string | null | undefined
) {
  return podeDecidirAprovacaoRma(user, responsavelComercialId);
}


function emailsAlertaDoProcessoRma(
  proc: {
    destinatarios?: Array<{
      usuario: { email?: string | null; ativo?: boolean };
    }>;
    criadoPor?: { email?: string | null } | null;
    responsavelComercial?: { email?: string | null } | null;
  },
  userEmail?: string | null
): string[] {
  return emailsAlertaDeUsuariosRma([
    ...(proc.destinatarios || []).map((d) => d.usuario),
    proc.criadoPor,
    proc.responsavelComercial,
    userEmail ? { email: userEmail, ativo: true } : null,
  ]);
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


async function exigirDocumentosParaEnvioCliente(opts: {
  processoId: string;
  nfEntradaAtual: string | null | undefined;
  nfSaidaAtual: string | null | undefined;
  nfSaidaInformada?: string | null;
}): Promise<{ numero: string; arquivo: string }> {
  if (!opts.nfEntradaAtual?.trim()) {
    throw new AppError(
      400,
      "Informe o número da NF de entrada antes de enviar ao cliente."
    );
  }
  const numero =
    opts.nfSaidaInformada?.trim() || opts.nfSaidaAtual?.trim() || "";
  const faltaNumero = mensagemBloqueioNfRetorno({
    nfSaidaNumero: numero,
    temArquivoNfSaida: true,
  });
  if (faltaNumero) throw new AppError(400, faltaNumero);
  if (!mesmaNotaFiscalNumero(numero, opts.nfSaidaAtual)) {
    await assertNotaFiscalNumeroLivre({
      numero,
      operacao: "SAIDA",
      exclude: { rmaProcessoId: opts.processoId },
    });
    await prisma.rmaProcesso.update({
      where: { id: opts.processoId },
      data: { nfSaidaNumero: numero },
    });
  }
  const arquivo = await arquivoAnexoAtivo(opts.processoId, "NF_SAIDA");
  const faltaArquivo = mensagemBloqueioNfRetorno({
    nfSaidaNumero: numero,
    temArquivoNfSaida: Boolean(arquivo),
  });
  if (faltaArquivo || !arquivo) {
    throw new AppError(
      400,
      faltaArquivo ?? "Anexe o arquivo da NF de retorno antes de liberar o equipamento"
    );
  }
  return { numero, arquivo };
}

/** Número + arquivo já gravados no processo — usado na liberação (checklist / skip). */
export async function exigirNfRetornoParaLiberacao(opts: {
  processoId: string;
  nfSaidaNumero?: string | null;
}) {
  const arquivo = await arquivoAnexoAtivo(opts.processoId, "NF_SAIDA");
  const msg = mensagemBloqueioNfRetorno({
    nfSaidaNumero: opts.nfSaidaNumero,
    temArquivoNfSaida: Boolean(arquivo),
  });
  if (msg) throw new AppError(400, msg);
}

async function fecharProcessoAgora(processoId: string) {
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

/** Fecha só após retorno ao cliente (devolução/troca) com NF de saída, quando não resta item em atendimento. */
async function maybeFecharAposRetornoAoCliente(processoId: string) {
  const proc = await prisma.rmaProcesso.findUnique({
    where: { id: processoId },
    select: {
      status: true,
      nfSaidaNumero: true,
      itens: { select: { status: true, movSaidaId: true } },
    },
  });
  if (!proc || proc.status !== "ABERTO") return;
  if (!proc.nfSaidaNumero?.trim()) return;
  const aindaEmAtendimento = proc.itens.some((i) =>
    (ITEM_NO_RMA as readonly string[]).includes(i.status)
  );
  if (aindaEmAtendimento) return;
  const retornouAoCliente = proc.itens.some(
    (i) => i.status === "DEVOLVIDO" || Boolean(i.movSaidaId)
  );
  if (!retornouAoCliente) return;
  await fecharProcessoAgora(processoId);
}

export async function listarRma(
  user: AuthUser,
  q: {
    status?: string;
    etapa?: string;
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

  const itemSome: Record<string, unknown> = {};
  if (
    q.etapa &&
    (RMA_ITEM_ETAPA as readonly string[]).includes(q.etapa)
  ) {
    itemSome.etapa = q.etapa;
  }
  if (q.cobrou === "true" || q.cobrou === "false" || q.cobrou === "null") {
    itemSome.cobrou =
      q.cobrou === "true" ? true : q.cobrou === "false" ? false : null;
  }
  if (Object.keys(itemSome).length > 0) {
    itemSome.status = { not: "CANCELADO" };
    where.itens = { some: itemSome };
  }

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
    prazoManutencao?: string | null;
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
  if (!cliente) throw new AppError(400, "Cliente não encontrado ou inativo. Selecione outro.");
  if (cliente.tipo === "FORNECEDOR") {
    throw new AppError(400, "Selecione um cliente (não fornecedor)");
  }

  await assertUsuarioComercialAtivo(input.responsavelComercialId);

  if (input.nfEntradaArquivo) {
    if (!isValidRmaTmpPath(input.nfEntradaArquivo, user.id)) {
      throw new AppError(
        400,
        "O anexo da NF de entrada expirou ou é inválido. Anexe o arquivo de novo."
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

  const tipoEntrada = await tipoEntradaRma();

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
  if (!input.nfEntradaNumero?.trim()) {
    throw new AppError(400, "Informe o número da NF de entrada");
  }

  await assertNotaFiscalNumeroLivre({
    numero: input.nfEntradaNumero,
    operacao: "ENTRADA",
  });

  const processo = await prisma.rmaProcesso.create({
    data: {
      clienteId: cliente.id,
      filialId: estoqueRma.id,
      status: "ABERTO",
      nfEntradaNumero: input.nfEntradaNumero?.trim() || null,
      observacao: input.observacao?.trim() || null,
      prazoManutencao: (() => {
        const ymd = parseYmd(input.prazoManutencao);
        return ymd ? new Date(`${ymd}T00:00:00.000Z`) : null;
      })(),
      criadoPorId: user.id,
      responsavelComercialId: input.responsavelComercialId,
    },
  });

  // NF fica em _tmp até as entradas confirmarem — evita órfão em atual/ se rollback
  const nfTmp = input.nfEntradaArquivo || null;
  const feitos: EntradaRmaFeita[] = [];

  try {
    for (const linha of linhas) {
      feitos.push(
        await lancarEntradaSerieRma(user, {
          processoId: processo.id,
          tipoEntradaId: tipoEntrada.id,
          produtoId: linha.produtoId,
          produtoCodigo: linha.codigo,
          filialId: estoqueRma.id,
          clienteId: cliente.id,
          numeroSerie: linha.series[0]!,
          notaFiscalNumero: input.nfEntradaNumero?.trim() || null,
          notaFiscalArquivo: nfTmp,
          observacaoItem: linha.observacao,
          observacaoMov: `RMA ${processo.id.slice(0, 8)}${
            linha.observacao ? ` — ${linha.observacao}` : ""
          }`,
        })
      );
    }
  } catch (e) {
    const falhasComp = await compensarEntradasRma(
      user,
      feitos,
      `Rollback abertura RMA ${processo.id.slice(0, 8)}`
    );

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
    const raw = e instanceof Error ? e.message : "";
    const tecnico =
      /prisma|invalid `prisma|unique constraint|foreign key|deadlock/i.test(
        raw
      );
    throw new AppError(
      400,
      tecnico || !raw
        ? "Não foi possível abrir o RMA. Confira se a série já está em estoque ou tente de novo."
        : raw
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
  if (!cliente) throw new AppError(400, "Cliente não encontrado ou inativo. Selecione outro.");
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
    ["AGUARDANDO_RECEBIMENTO","AGUARDANDO_ORCAMENTO","AGUARDANDO_APROVACAO","AGUARDANDO_LAUDO"].includes(i.etapa || "")
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
  if ((item as { orcamento?: { id: string } | null }).orcamento) {
    const { decidirOrcamentoRmaItem } = await import("./rmaWorkflowService");
    return decidirOrcamentoRmaItem(
      user,
      processoId,
      itemId,
      input.decisao === "APROVADA" ? "APROVADO" : "RECUSADO",
      input.observacao
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
  const orc = (item as { orcamento?: { status: string } | null }).orcamento;
  if (orc && orc.status !== "APROVADO") {
    throw new AppError(400, "Orçamento precisa estar aprovado");
  }
  const temLiberacao = await produtoTemChecklistAtivo(
    item.produtoId,
    "LIBERACAO"
  );
  const proximaEtapa = temLiberacao
    ? "AGUARDANDO_LIBERACAO"
    : "AGUARDANDO_ENVIO";
  if (proximaEtapa === "AGUARDANDO_ENVIO") {
    await exigirNfRetornoParaLiberacao({
      processoId,
      nfSaidaNumero: proc.nfSaidaNumero,
    });
  }
  const claim = await prisma.rmaItem.updateMany({
    where: {
      id: itemId,
      processoId,
      etapa: "AGUARDANDO_MANUTENCAO",
    },
    data: { etapa: proximaEtapa },
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
    if (!mesmaNotaFiscalNumero(nfCob, item.nfCobrancaNumero)) {
      await assertNotaFiscalNumeroLivre({
        numero: nfCob,
        operacao: "COBRANCA",
        exclude: { rmaProcessoId: processoId, rmaItemId: itemId },
      });
    }
    data.valorCobrado = valor;
    data.nfCobrancaNumero = nfCob;
  } else if (cobrou === false) {
    data.valorCobrado = null;
    data.nfCobrancaNumero = null;
  } else {
    if (input.valorCobrado !== undefined) data.valorCobrado = input.valorCobrado;
    if (input.nfCobrancaNumero !== undefined) {
      const nfCob = input.nfCobrancaNumero?.trim() || null;
      if (nfCob && !mesmaNotaFiscalNumero(nfCob, item.nfCobrancaNumero)) {
        await assertNotaFiscalNumeroLivre({
          numero: nfCob,
          operacao: "COBRANCA",
          exclude: { rmaProcessoId: processoId, rmaItemId: itemId },
        });
      }
      data.nfCobrancaNumero = nfCob;
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

  const tipoEntrada = await tipoEntradaRma();
  const nfEntradaArquivo = await arquivoAnexoAtivo(id, "NF_ENTRADA");
  const feitos: EntradaRmaFeita[] = [];

  try {
    for (const sn of series) {
      feitos.push(
        await lancarEntradaSerieRma(user, {
          processoId: id,
          tipoEntradaId: tipoEntrada.id,
          produtoId: produto.id,
          produtoCodigo: produto.codigo,
          filialId: proc.filialId,
          clienteId: proc.clienteId,
          numeroSerie: sn,
          notaFiscalNumero: proc.nfEntradaNumero,
          notaFiscalArquivo: nfEntradaArquivo,
          observacaoItem: input.observacao,
          observacaoMov: `RMA ${id.slice(0, 8)} (item incluído)${
            input.observacao ? ` — ${input.observacao}` : ""
          }`,
        })
      );
    }
  } catch (e) {
    const falhasComp = await compensarEntradasRma(
      user,
      feitos,
      `Rollback inclusão RMA ${id.slice(0, 8)}`
    );
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

  // Escopo: entrada vinculada a este item (histórico), não a flag RMA atual do tipo
  const movEntrada = await prisma.movimentacao.findFirst({
    where: {
      id: item.movEntradaId,
      status: "CONCLUIDO",
      tipo: { operacao: "ENTRADA" },
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
        etapa: item.etapa || "AGUARDANDO_RECEBIMENTO",
        observacao: item.observacao,
      },
    });
    throw inner;
  }

  await prisma.rmaProcesso.update({
    where: { id },
    data: { observacao: observacaoProcesso },
  });

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
    prazoManutencao?: string | null;
  }
) {
  const proc = await prisma.rmaProcesso.findUnique({ where: { id } });
  if (!proc) throw new AppError(404, "Processo RMA não encontrado");
  assertPodeVerProcesso(user, proc.filialId);
  if (proc.status === "CANCELADO") {
    throw new AppError(400, "Processo cancelado — não é possível alterar o financeiro");
  }
  if (proc.status === "FECHADO") {
    const soCorrecaoNf =
      input.cobrou === undefined &&
      input.valorCobrado === undefined &&
      input.nfCobrancaNumero === undefined;
    if (!soCorrecaoNf) {
      throw new AppError(
        400,
        "Processo fechado — só número e arquivo da NF de entrada/retorno podem ser corrigidos"
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (input.nfEntradaNumero !== undefined) {
    const nf = input.nfEntradaNumero?.trim() || null;
    if (!nf) {
      throw new AppError(
        400,
        "Informe o número da NF de entrada. Se estiver errada, troque pelo número correto."
      );
    }
    if (!mesmaNotaFiscalNumero(nf, proc.nfEntradaNumero)) {
      await assertNotaFiscalNumeroLivre({
        numero: nf,
        operacao: "ENTRADA",
        exclude: { rmaProcessoId: id },
      });
    }
    data.nfEntradaNumero = nf;
  }
  if (input.nfSaidaNumero !== undefined) {
    const nf = input.nfSaidaNumero?.trim() || null;
    const entradaFinal =
      input.nfEntradaNumero !== undefined
        ? input.nfEntradaNumero?.trim() || null
        : proc.nfEntradaNumero;
    if (nf) {
      const bloqueioEntrada = mensagemBloqueioNfRetornoSemEntrada({
        nfEntradaNumero: entradaFinal,
      });
      if (bloqueioEntrada) throw new AppError(400, bloqueioEntrada);
      if (!mesmaNotaFiscalNumero(nf, proc.nfSaidaNumero)) {
        await assertNotaFiscalNumeroLivre({
          numero: nf,
          operacao: "SAIDA",
          exclude: { rmaProcessoId: id },
        });
      }
    }
    data.nfSaidaNumero = nf;
  }
  if (input.observacao !== undefined) {
    data.observacao = input.observacao?.trim() || null;
  }
  if (input.prazoManutencao !== undefined) {
    if (proc.status !== "ABERTO") {
      throw new AppError(
        400,
        "Prazo da manutenção só pode ser alterado em RMA aberto"
      );
    }
    const ymd = parseYmd(input.prazoManutencao);
    data.prazoManutencao = ymd ? new Date(`${ymd}T00:00:00.000Z`) : null;
  }
  // Compat: ainda aceita cobrança no processo, mas a UI usa o item
  if (input.cobrou !== undefined) data.cobrou = input.cobrou;
  if (input.valorCobrado !== undefined) data.valorCobrado = input.valorCobrado;
  if (input.nfCobrancaNumero !== undefined) {
    const nf = input.nfCobrancaNumero?.trim() || null;
    if (nf && !mesmaNotaFiscalNumero(nf, proc.nfCobrancaNumero)) {
      await assertNotaFiscalNumeroLivre({
        numero: nf,
        operacao: "COBRANCA",
        exclude: { rmaProcessoId: id },
      });
    }
    data.nfCobrancaNumero = nf;
  }

  if (Object.keys(data).length === 0) {
    return obterRma(user, id);
  }

  await prisma.rmaProcesso.update({ where: { id }, data });

  const nfEntNova =
    typeof data.nfEntradaNumero === "string" ? data.nfEntradaNumero : null;
  const nfSaiNova =
    typeof data.nfSaidaNumero === "string" ? data.nfSaidaNumero : null;
  if (nfEntNova) {
    await prisma.movimentacao.updateMany({
      where: {
        rmaItensEntrada: { some: { processoId: id } },
        status: { notIn: ["ESTORNADO", "REJEITADO"] },
      },
      data: { notaFiscalNumero: nfEntNova },
    });
  }
  if (nfSaiNova) {
    await prisma.movimentacao.updateMany({
      where: {
        rmaItensSaida: { some: { processoId: id } },
        status: { notIn: ["ESTORNADO", "REJEITADO"] },
      },
      data: { notaFiscalNumero: nfSaiNova },
    });
  }

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
  // NF entrada/retorno: dá para trocar o arquivo se a nota veio errada, mesmo após FECHADO.
  // NF cobrança: financeiro pode anexar também após FECHADO.
  if (
    proc.status === "FECHADO" &&
    tipo !== "NF_COBRANCA" &&
    tipo !== "NF_ENTRADA" &&
    tipo !== "NF_SAIDA"
  ) {
    throw new AppError(
      400,
      "Processo fechado — só as NFs (entrada, retorno e cobrança) podem ser trocadas"
    );
  }

  const precisaCobranca = tipo === "NF_COBRANCA";
  if (precisaCobranca && !opts?.podeFinanceiro) {
    throw new AppError(
      403,
      "NF de cobrança exige permissão RMA financeiro"
    );
  }

  if (tipo === "NF_SAIDA") {
    const temArquivoEntrada = Boolean(
      await arquivoAnexoAtivo(id, "NF_ENTRADA")
    );
    const bloqueio = mensagemBloqueioNfRetornoSemEntrada({
      nfEntradaNumero: proc.nfEntradaNumero,
      temArquivoNfEntrada: temArquivoEntrada,
      exigeArquivoEntrada: true,
    });
    if (bloqueio) throw new AppError(400, bloqueio);
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
    throw new AppError(
      400,
      "Laudo por arquivo não é mais usado — registre o diagnóstico no item (checklist/plano)"
    );
  } else if (itemId) {
    itemId = null;
  }

  const label = input.label?.trim() || null;
  const substituivel =
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
            itemId: null,
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

  const tipoSaida = await tipoSaidaRma();

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

  const { numero: nfSaida, arquivo: nfSaidaArquivo } =
    await exigirDocumentosParaEnvioCliente({
      processoId: id,
      nfEntradaAtual: proc.nfEntradaNumero,
      nfSaidaAtual: proc.nfSaidaNumero,
      nfSaidaInformada: input.nfSaidaNumero,
    });
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
          alertaEmails: emailsAlertaDoProcessoRma(proc, user.email),
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

  await maybeFecharAposRetornoAoCliente(id);
  return obterRma(user, id);
}

/** Marca itens no RMA como SEM_MANUTENCAO (decisão de processo; sem mover saldo).
 * Só avança etapa para NAO_APROVADO (libera Devolver/Trocar) na decisão comercial. */
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
    const liberaSaida =
      item.etapa === "AGUARDANDO_ORCAMENTO" ||
      item.etapa === "AGUARDANDO_APROVACAO" ||
      item.etapa === "NAO_APROVADO";
    const claim = await prisma.rmaItem.updateMany({
      where: { id: item.id, status: "EM_ESTOQUE", etapa: item.etapa },
      data: {
        status: "SEM_MANUTENCAO",
        ...(liberaSaida ? { etapa: "NAO_APROVADO" } : {}),
      },
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

  const { numero: nfSaida, arquivo: nfSaidaArquivo } =
    await exigirDocumentosParaEnvioCliente({
      processoId,
      nfEntradaAtual: proc.nfEntradaNumero,
      nfSaidaAtual: proc.nfSaidaNumero,
      nfSaidaInformada: input.nfSaidaNumero,
    });

  const tipoSaida = await tipoSaidaRma();
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
      alertaEmails: emailsAlertaDoProcessoRma(proc, user.email),
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

  await maybeFecharAposRetornoAoCliente(processoId);
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
      "Processo fechado — não é possível cancelar"
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
            etapa: item.etapa || "AGUARDANDO_RECEBIMENTO",
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
      `Processo ${proc.status === "CANCELADO" ? "cancelado" : "fechado"} — não é possível notificar`
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

  const appUrl =
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    "http://localhost:3000";

  type LinhaResumo = { key: string; texto: string };
  const linhas: LinhaResumo[] = [];

  // Laudo no sistema = diagnóstico (e, se houver, checklist de entrada concluído).
  for (const item of proc.itens || []) {
    if (item.status === "CANCELADO") continue;
    const prod = `${item.produto.codigo}${
      item.unidadeSerie ? ` S/N ${item.unidadeSerie.numeroSerie}` : ""
    }`;
    const diag = item.diagnostico;
    if (diag?.resumoProblema) {
      const resumo = diag.resumoProblema.trim().slice(0, 160);
      linhas.push({
        key: `diag:${item.id}`,
        texto: `${prod} — diagnóstico: ${resumo}${
          diag.resumoProblema.trim().length > 160 ? "…" : ""
        } (ver em ${appUrl}/rma/${id})`,
      });
      continue;
    }
    const recv = (item.checklistExecucoes || []).find(
      (e) => e.tipo === "RECEBIMENTO" && e.status === "CONCLUIDO"
    );
    if (recv) {
      linhas.push({
        key: `chk:${item.id}`,
        texto: `${prod} — checklist de entrada concluído (ver em ${appUrl}/rma/${id})`,
      });
    }
  }

  // Anexos antigos (se ainda existirem) entram como complemento.
  const laudosArquivo = [
    ...(proc.anexos || [])
      .filter((a) => a.tipo === "LAUDO" && a.ativo !== false)
      .map((a) => ({ item: null as (typeof proc.itens)[0] | null, anexo: a })),
    ...(proc.itens || []).flatMap((i) =>
      (i.anexos || [])
        .filter((a) => a.tipo === "LAUDO" && a.ativo !== false)
        .map((a) => ({ item: i, anexo: a }))
    ),
  ];
  const seenAnexo = new Set<string>();
  for (const { item, anexo } of laudosArquivo) {
    if (seenAnexo.has(anexo.id)) continue;
    seenAnexo.add(anexo.id);
    const prod = item
      ? `${item.produto.codigo}${
          item.unidadeSerie ? ` S/N ${item.unidadeSerie.numeroSerie}` : ""
        }`
      : "processo";
    linhas.push({
      key: `arq:${anexo.id}`,
      texto: `${prod} — arquivo: ${anexo.label || "Laudo"} (ver em ${appUrl}/rma/${id})`,
    });
  }

  if (linhas.length === 0) {
    throw new AppError(
      400,
      "Nenhum diagnóstico ou checklist de entrada concluído para notificar"
    );
  }

  notificarRmaLaudos({
    processoId: id,
    clienteNome: proc.cliente.nome,
    destinatarioIds: destIds,
    laudosResumo: linhas.map((l) => l.texto),
  });

  // Etapas avançam pelo checklist/diagnóstico/orçamento — notificar só alerta.

  return {
    ok: true,
    qtdLaudos: linhas.length,
    qtdDestinatarios: destIds.length,
  };
}

