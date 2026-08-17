import { Prisma } from "@prisma/client";
import {
  BRAND_COLOR,
  RMA_CHECKLIST_CAMPO_TIPOS,
  mensagemBloqueioDiagnostico,
  mensagemBloqueioReabrirOrcamento,
  rmaEtapaEmRecebimento,
  rmaOrcamentoPodeEditar,
  type RmaChecklistTipo,
} from "@teep/shared";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import type { AuthUser } from "../middleware/auth";
import {
  isValidRmaStoredPath,
  isValidRmaTmpPath,
  promoteRmaTmpToAtual,
  rollbackRmaPromote,
  type RmaPromoteResult,
} from "../lib/rmaUploads";
import { htmlToPdf } from "../lib/pdf";
import { brandAssetDataUri } from "../lib/brandAssets";
import { obterRma, podeDecidirAprovacaoRma } from "./rmaService";

const ETAPAS_RECEBIMENTO = [
  "AGUARDANDO_RECEBIMENTO",
  "AGUARDANDO_LAUDO",
] as const;

const templateInclude = {
  produto: { select: { id: true, codigo: true, descricao: true } },
  itens: { orderBy: { ordem: "asc" as const } },
} as const;

const pecaProdutoSelect = {
  id: true,
  codigo: true,
  descricao: true,
  precoUnitario: true,
} as const;

function assertProcessoAberto(status: string) {
  if (status !== "ABERTO") {
    throw new AppError(400, "Só permitido em RMA aberto");
  }
}

async function produtoTemChecklistRecebimento(produtoId: string) {
  const t = await prisma.rmaChecklistTemplate.findFirst({
    where: {
      produtoId,
      tipo: "RECEBIMENTO",
      ativo: true,
      itens: { some: {} },
    },
    select: { id: true },
  });
  return Boolean(t);
}

async function assertChecklistRecebimentoOkParaDiagnostico(item: {
  produtoId: string;
  checklistExecucoes: Array<{ tipo: string; status: string }>;
}) {
  const recv = item.checklistExecucoes.find((e) => e.tipo === "RECEBIMENTO");
  const temTemplate = recv
    ? true
    : await produtoTemChecklistRecebimento(item.produtoId);
  const msg = mensagemBloqueioDiagnostico({
    execucaoRecebimento: recv || null,
    temTemplateRecebimento: temTemplate,
  });
  if (msg) throw new AppError(400, msg);
}

async function loadItemNoProcesso(processoId: string, itemId: string) {
  const item = await prisma.rmaItem.findFirst({
    where: { id: itemId, processoId },
    include: {
      produto: {
        select: {
          id: true,
          codigo: true,
          descricao: true,
          precoUnitario: true,
        },
      },
      checklistExecucoes: {
        include: {
          template: { include: { itens: { orderBy: { ordem: "asc" } } } },
          respostas: true,
          preenchidoPor: { select: { id: true, nome: true } },
        },
      },
      diagnostico: true,
      manutencaoPlano: {
        include: {
          servicos: { orderBy: { ordem: "asc" } },
          pecas: { include: { produto: { select: pecaProdutoSelect } } },
        },
      },
      orcamento: {
        include: {
          linhas: {
            include: { produto: { select: pecaProdutoSelect } },
            orderBy: { id: "asc" },
          },
          aprovadoPor: { select: { id: true, nome: true } },
        },
      },
    },
  });
  if (!item) throw new AppError(404, "Item do RMA não encontrado");
  return item;
}

export async function listarRmaChecklistTemplates(filtros?: {
  produtoId?: string;
  tipo?: string;
  /** default true — só templates ativos; passe false para incluir histórico */
  somenteAtivos?: boolean;
}) {
  const somenteAtivos = filtros?.somenteAtivos !== false;
  return prisma.rmaChecklistTemplate.findMany({
    where: {
      ...(filtros?.produtoId ? { produtoId: filtros.produtoId } : {}),
      ...(filtros?.tipo ? { tipo: filtros.tipo } : {}),
      ...(somenteAtivos ? { ativo: true } : {}),
    },
    include: templateInclude,
    orderBy: [{ tipo: "asc" }, { atualizadoEm: "desc" }],
  });
}

export async function obterRmaChecklistTemplate(id: string) {
  const t = await prisma.rmaChecklistTemplate.findUnique({
    where: { id },
    include: templateInclude,
  });
  if (!t) throw new AppError(404, "Template de checklist não encontrado");
  return t;
}

export async function upsertRmaChecklistTemplate(input: {
  produtoId: string;
  tipo: RmaChecklistTipo;
  nome: string;
  ativo?: boolean;
  itens: Array<{
    codigo: string;
    titulo: string;
    ajuda?: string | null;
    tipoCampo: string;
    obrigatorio: boolean;
    ordem: number;
    opcoes?: string[];
    exigeFotoSe?: string | null;
  }>;
}) {
  const produto = await prisma.produto.findUnique({
    where: { id: input.produtoId },
    select: { id: true },
  });
  if (!produto) throw new AppError(400, "Produto inválido");

  for (const it of input.itens) {
    if (
      !(RMA_CHECKLIST_CAMPO_TIPOS as readonly string[]).includes(it.tipoCampo)
    ) {
      throw new AppError(400, `Tipo de campo inválido: ${it.tipoCampo}`);
    }
    if (it.tipoCampo === "OPCAO" && !(it.opcoes && it.opcoes.length > 0)) {
      throw new AppError(400, `Item ${it.codigo}: OPCAO exige opções`);
    }
  }

  const existing = await prisma.rmaChecklistTemplate.findFirst({
    where: { produtoId: input.produtoId, tipo: input.tipo, ativo: true },
  });

  const itensCreate = input.itens.map((it, idx) => ({
    codigo: it.codigo.trim(),
    titulo: it.titulo.trim(),
    ajuda: it.ajuda?.trim() || null,
    tipoCampo: it.tipoCampo,
    obrigatorio: it.obrigatorio !== false,
    ordem: it.ordem ?? idx,
    opcoesJson: it.opcoes?.length
      ? (it.opcoes as Prisma.InputJsonValue)
      : Prisma.JsonNull,
    exigeFotoSe: it.exigeFotoSe?.trim() || null,
  }));

  if (existing) {
    // Sempre nova versão se já existe ativo: evita TOCTOU (delete itens sob execução)
    // e preserva FKs de respostas antigas.
    try {
      const created = await prisma.$transaction(async (tx) => {
        const claim = await tx.rmaChecklistTemplate.updateMany({
          where: { id: existing.id, ativo: true },
          data: { ativo: false },
        });
        if (claim.count === 0) {
          throw new AppError(409, "Template alterado por outro usuário — atualize");
        }
        return tx.rmaChecklistTemplate.create({
          data: {
            produtoId: input.produtoId,
            tipo: input.tipo,
            nome: input.nome.trim(),
            ativo: input.ativo !== false,
            versao: existing.versao + 1,
            itens: { create: itensCreate },
          },
        });
      });
      return obterRmaChecklistTemplate(created.id);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new AppError(
          409,
          "Outro template ativo foi criado ao mesmo tempo — atualize e tente de novo"
        );
      }
      throw e;
    }
  }

  try {
    const created = await prisma.rmaChecklistTemplate.create({
      data: {
        produtoId: input.produtoId,
        tipo: input.tipo,
        nome: input.nome.trim(),
        ativo: input.ativo !== false,
        itens: { create: itensCreate },
      },
    });
    return obterRmaChecklistTemplate(created.id);
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      throw new AppError(
        409,
        "Já existe template ativo para este produto/tipo — atualize e edite"
      );
    }
    throw e;
  }
}

export async function clonarRmaChecklistTemplate(input: {
  produtoOrigemId: string;
  produtoDestinoId: string;
  tipo: RmaChecklistTipo;
  nome?: string;
}) {
  if (input.produtoOrigemId === input.produtoDestinoId) {
    throw new AppError(400, "Produto origem e destino devem ser diferentes");
  }
  const origem = await prisma.rmaChecklistTemplate.findFirst({
    where: {
      produtoId: input.produtoOrigemId,
      tipo: input.tipo,
      ativo: true,
    },
    include: { itens: { orderBy: { ordem: "asc" } } },
  });
  if (!origem) {
    throw new AppError(404, "Template de origem não encontrado");
  }
  const destProduto = await prisma.produto.findUnique({
    where: { id: input.produtoDestinoId },
    select: { codigo: true },
  });
  if (!destProduto) throw new AppError(400, "Produto destino inválido");

  return upsertRmaChecklistTemplate({
    produtoId: input.produtoDestinoId,
    tipo: input.tipo,
    nome:
      input.nome?.trim() ||
      `${origem.nome} (cópia → ${destProduto.codigo})`,
    ativo: true,
    itens: origem.itens.map((it) => ({
      codigo: it.codigo,
      titulo: it.titulo,
      ajuda: it.ajuda,
      tipoCampo: it.tipoCampo,
      obrigatorio: it.obrigatorio,
      ordem: it.ordem,
      opcoes: Array.isArray(it.opcoesJson)
        ? (it.opcoesJson as string[])
        : undefined,
      exigeFotoSe: it.exigeFotoSe,
    })),
  });
}

async function resolverTemplateAtivo(
  produtoId: string,
  tipo: RmaChecklistTipo
) {
  const t = await prisma.rmaChecklistTemplate.findFirst({
    where: { produtoId, tipo, ativo: true },
    include: { itens: { orderBy: { ordem: "asc" } } },
  });
  if (!t || t.itens.length === 0) {
    throw new AppError(
      400,
      `Cadastre o checklist de ${tipo.toLowerCase()} para este produto em Cadastros → Checklists RMA`
    );
  }
  return t;
}

export async function iniciarOuObterChecklist(
  user: AuthUser,
  processoId: string,
  itemId: string,
  tipo: RmaChecklistTipo
) {
  const proc = await obterRma(user, processoId);
  assertProcessoAberto(proc.status);
  const item = await loadItemNoProcesso(processoId, itemId);

  if (tipo === "RECEBIMENTO") {
    if (!rmaEtapaEmRecebimento(item.etapa)) {
      throw new AppError(
        400,
        "Checklist de recebimento só na etapa de recebimento"
      );
    }
  } else if (item.etapa !== "AGUARDANDO_LIBERACAO") {
    throw new AppError(
      400,
      "Checklist de liberação só na etapa de liberação"
    );
  }

  const existing = item.checklistExecucoes.find((e) => e.tipo === tipo);
  if (existing) {
    return existing;
  }

  const template = await resolverTemplateAtivo(item.produtoId, tipo);
  try {
    return await prisma.rmaChecklistExecucao.create({
      data: {
        rmaItemId: itemId,
        templateId: template.id,
        tipo,
        status: "EM_PREENCHIMENTO",
        preenchidoPorId: user.id,
      },
      include: {
        template: { include: { itens: { orderBy: { ordem: "asc" } } } },
        respostas: true,
        preenchidoPor: { select: { id: true, nome: true } },
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const again = await loadItemNoProcesso(processoId, itemId);
      const got = again.checklistExecucoes.find((x) => x.tipo === tipo);
      if (got) return got;
    }
    throw e;
  }
}

function validarRespostasContraTemplate(
  templateItens: Array<{
    id: string;
    codigo: string;
    tipoCampo: string;
    obrigatorio: boolean;
    exigeFotoSe: string | null;
    opcoesJson?: unknown;
  }>,
  respostas: Array<{
    templateItemId: string;
    valorTexto?: string | null;
    valorBool?: boolean | null;
    fotos?: string[];
  }>,
  concluir: boolean
) {
  const byId = new Map(respostas.map((r) => [r.templateItemId, r]));
  for (const ti of templateItens) {
    const r = byId.get(ti.id);
    const fotos = r?.fotos || [];
    if (!concluir) continue;

    if (ti.obrigatorio) {
      if (ti.tipoCampo === "SIM_NAO" && r?.valorBool == null) {
        throw new AppError(400, `Responda: ${ti.codigo}`);
      }
      if (
        (ti.tipoCampo === "TEXTO" || ti.tipoCampo === "OPCAO") &&
        !r?.valorTexto?.trim()
      ) {
        throw new AppError(400, `Preencha: ${ti.codigo}`);
      }
      if (ti.tipoCampo === "FOTO" && fotos.length === 0) {
        throw new AppError(400, `Anexe foto: ${ti.codigo}`);
      }
    }

    if (ti.tipoCampo === "OPCAO" && r?.valorTexto?.trim()) {
      const opcoes = Array.isArray(ti.opcoesJson)
        ? (ti.opcoesJson as string[])
        : [];
      if (opcoes.length && !opcoes.includes(r.valorTexto.trim())) {
        throw new AppError(400, `Opção inválida em ${ti.codigo}`);
      }
    }

    if (ti.exigeFotoSe) {
      const val =
        ti.tipoCampo === "SIM_NAO"
          ? r?.valorBool === false
            ? "NAO"
            : r?.valorBool === true
              ? "SIM"
              : ""
          : (r?.valorTexto || "").trim().toUpperCase();
      const trigger = ti.exigeFotoSe.trim().toUpperCase();
      if (val === trigger && fotos.length === 0) {
        throw new AppError(
          400,
          `Foto obrigatória para ${ti.codigo} quando resposta = ${ti.exigeFotoSe}`
        );
      }
    }
  }
}

function assertFotosChecklistValidas(
  user: AuthUser,
  processoId: string,
  fotos: string[] | undefined
) {
  for (const raw of fotos || []) {
    const f = String(raw || "").trim();
    if (!f) continue;
    if (
      isValidRmaTmpPath(f, user.id) ||
      isValidRmaStoredPath(f, { processoId, userId: user.id })
    ) {
      continue;
    }
    throw new AppError(400, "Foto de checklist inválida ou fora do escopo RMA");
  }
}

/** Promove `_tmp` → `atual`; devolve URLs finais + placed para rollback. */
function promoverFotosChecklist(
  user: AuthUser,
  processoId: string,
  itemId: string,
  fotos: string[] | undefined
): { urls: string[]; placed: RmaPromoteResult[] } {
  const urls: string[] = [];
  const placed: RmaPromoteResult[] = [];
  try {
    for (const raw of fotos || []) {
      const f = String(raw || "").trim();
      if (!f) continue;
      if (isValidRmaTmpPath(f, user.id)) {
        const p = promoteRmaTmpToAtual({
          processoId,
          tipo: "OUTRO",
          itemId,
          tmpPublicUrl: f,
        });
        placed.push(p);
        urls.push(p.publicUrl);
        continue;
      }
      if (isValidRmaStoredPath(f, { processoId, userId: user.id })) {
        urls.push(f);
        continue;
      }
      throw new AppError(400, "Foto de checklist inválida ou fora do escopo RMA");
    }
    return { urls, placed };
  } catch (e) {
    for (const p of placed) rollbackRmaPromote(p);
    throw e;
  }
}

function rollbackPlaced(placed: RmaPromoteResult[]) {
  for (const p of placed) rollbackRmaPromote(p);
}

export async function salvarChecklistRespostas(
  user: AuthUser,
  processoId: string,
  itemId: string,
  tipo: RmaChecklistTipo,
  input: {
    respostas: Array<{
      templateItemId: string;
      valorTexto?: string | null;
      valorBool?: boolean | null;
      fotos?: string[];
    }>;
  },
  concluir: boolean
) {
  const proc = await obterRma(user, processoId);
  assertProcessoAberto(proc.status);
  const item = await loadItemNoProcesso(processoId, itemId);

  if (tipo === "RECEBIMENTO") {
    if (!rmaEtapaEmRecebimento(item.etapa)) {
      throw new AppError(400, "Checklist de recebimento só na etapa de recebimento");
    }
  } else if (tipo === "LIBERACAO") {
    if (item.etapa !== "AGUARDANDO_LIBERACAO") {
      throw new AppError(400, "Checklist de liberação só na etapa de liberação");
    }
  }

  let exec = item.checklistExecucoes.find((e) => e.tipo === tipo);
  if (!exec) {
    await iniciarOuObterChecklist(user, processoId, itemId, tipo);
    const refreshed = await loadItemNoProcesso(processoId, itemId);
    exec = refreshed.checklistExecucoes.find((e) => e.tipo === tipo);
  }
  if (!exec) throw new AppError(500, "Falha ao iniciar checklist");
  if (exec.status === "CONCLUIDO") {
    throw new AppError(400, "Checklist já concluído");
  }

  const templateItens = exec.template.itens;
  const allowed = new Set(templateItens.map((t) => t.id));
  for (const r of input.respostas) {
    if (!allowed.has(r.templateItemId)) {
      throw new AppError(400, "Item de checklist inválido para este template");
    }
    assertFotosChecklistValidas(user, processoId, r.fotos);
  }

  validarRespostasContraTemplate(templateItens, input.respostas, concluir);

  const allPlaced: RmaPromoteResult[] = [];
  let respostasNorm: Array<{
    templateItemId: string;
    valorTexto?: string | null;
    valorBool?: boolean | null;
    fotos: string[];
  }>;
  try {
    respostasNorm = input.respostas.map((r) => {
      const { urls, placed } = promoverFotosChecklist(
        user,
        processoId,
        itemId,
        r.fotos
      );
      allPlaced.push(...placed);
      return { ...r, fotos: urls };
    });

    await prisma.$transaction(async (tx) => {
      const claimExec = await tx.rmaChecklistExecucao.updateMany({
        where: {
          id: exec!.id,
          status: "EM_PREENCHIMENTO",
        },
        data: {
          preenchidoPorId: user.id,
          ...(concluir
            ? { status: "CONCLUIDO", concluidoEm: new Date() }
            : { status: "EM_PREENCHIMENTO" }),
        },
      });
      if (claimExec.count === 0) {
        throw new AppError(409, "Checklist já concluído ou alterado — atualize");
      }

      for (const r of respostasNorm) {
        await tx.rmaChecklistResposta.upsert({
          where: {
            execucaoId_templateItemId: {
              execucaoId: exec!.id,
              templateItemId: r.templateItemId,
            },
          },
          create: {
            execucaoId: exec!.id,
            templateItemId: r.templateItemId,
            valorTexto: r.valorTexto?.trim() || null,
            valorBool: r.valorBool ?? null,
            fotos: r.fotos as Prisma.InputJsonValue,
          },
          update: {
            valorTexto: r.valorTexto?.trim() || null,
            valorBool: r.valorBool ?? null,
            fotos: r.fotos as Prisma.InputJsonValue,
          },
        });
      }

      if (concluir && tipo === "LIBERACAO") {
        const claim = await tx.rmaItem.updateMany({
          where: {
            id: itemId,
            processoId,
            etapa: "AGUARDANDO_LIBERACAO",
          },
          data: { etapa: "AGUARDANDO_ENVIO" },
        });
        if (claim.count === 0) {
          throw new AppError(409, "Item não está em liberação — atualize a tela");
        }
      }
    });
  } catch (e) {
    rollbackPlaced(allPlaced);
    throw e;
  }

  return obterRma(user, processoId);
}

export async function salvarDiagnosticoEPlano(
  user: AuthUser,
  processoId: string,
  itemId: string,
  input: {
    resumoProblema: string;
    observacaoTecnica?: string | null;
    servicos: Array<{
      descricao: string;
      ordem?: number;
      tempoMinutos?: number | null;
    }>;
    pecas: Array<{
      produtoId: string;
      quantidade: number;
      motivo?: string | null;
    }>;
  },
  concluir: boolean
) {
  const proc = await obterRma(user, processoId);
  assertProcessoAberto(proc.status);
  const item = await loadItemNoProcesso(processoId, itemId);

  if (!rmaEtapaEmRecebimento(item.etapa)) {
    throw new AppError(
      400,
      "Diagnóstico/plano só podem ser editados na etapa de recebimento"
    );
  }

  if (concluir) {
    await assertChecklistRecebimentoOkParaDiagnostico(item);
    if (input.servicos.length === 0 && input.pecas.length === 0) {
      throw new AppError(
        400,
        "Informe ao menos um serviço ou uma peça prevista no plano"
      );
    }
  }

  if (input.pecas.length > 0) {
    const ids = [...new Set(input.pecas.map((p) => p.produtoId))];
    const found = await prisma.produto.findMany({
      where: { id: { in: ids }, ativo: true },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new AppError(
        400,
        "A peça selecionada não existe ou está inativa. Selecione outra na lista."
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const claimEtapa = await tx.rmaItem.updateMany({
      where: {
        id: itemId,
        processoId,
        etapa: { in: [...ETAPAS_RECEBIMENTO] },
      },
      data: concluir
        ? { etapa: "AGUARDANDO_ORCAMENTO" }
        : { observacao: item.observacao },
    });
    if (claimEtapa.count === 0) {
      throw new AppError(
        409,
        "Item não está mais em recebimento — atualize a tela"
      );
    }

    await tx.rmaDiagnostico.upsert({
      where: { rmaItemId: itemId },
      create: {
        rmaItemId: itemId,
        resumoProblema: input.resumoProblema.trim(),
        observacaoTecnica: input.observacaoTecnica?.trim() || null,
      },
      update: {
        resumoProblema: input.resumoProblema.trim(),
        observacaoTecnica: input.observacaoTecnica?.trim() || null,
      },
    });

    const plano = await tx.rmaManutencaoPlano.upsert({
      where: { rmaItemId: itemId },
      create: { rmaItemId: itemId },
      update: {},
    });

    await tx.rmaManutencaoServico.deleteMany({ where: { planoId: plano.id } });
    await tx.rmaManutencaoPeca.deleteMany({ where: { planoId: plano.id } });

    if (input.servicos.length) {
      await tx.rmaManutencaoServico.createMany({
        data: input.servicos.map((s, idx) => ({
          planoId: plano.id,
          descricao: s.descricao.trim(),
          ordem: s.ordem ?? idx,
          tempoMinutos:
            s.tempoMinutos == null || Number.isNaN(Number(s.tempoMinutos))
              ? null
              : Math.max(0, Math.floor(Number(s.tempoMinutos))),
        })),
      });
    }
    if (input.pecas.length) {
      await tx.rmaManutencaoPeca.createMany({
        data: input.pecas.map((p) => ({
          planoId: plano.id,
          produtoId: p.produtoId,
          quantidade: p.quantidade,
          motivo: p.motivo?.trim() || null,
        })),
      });
    }
  });

  return obterRma(user, processoId);
}

function totalOrcamento(
  linhas: Array<{ quantidade: number; valorUnitario: number }>,
  maoDeObra: number,
  desconto: number
) {
  const sub = linhas.reduce(
    (acc, l) => acc + Number(l.quantidade) * Number(l.valorUnitario),
    0
  );
  return Math.max(0, Math.round((sub + maoDeObra - desconto) * 100) / 100);
}

export async function salvarOrcamentoRmaItem(
  user: AuthUser,
  processoId: string,
  itemId: string,
  input: {
    maoDeObra: number;
    desconto: number;
    observacaoComercial?: string | null;
    linhas: Array<{
      descricao: string;
      produtoId?: string | null;
      quantidade: number;
      valorUnitario: number;
      origem: "SERVICO" | "PECA" | "EXTRA";
      tempoMinutos?: number | null;
    }>;
  }
) {
  const proc = await obterRma(user, processoId);
  assertProcessoAberto(proc.status);
  const item = await loadItemNoProcesso(processoId, itemId);

  if (
    !rmaOrcamentoPodeEditar({
      etapa: item.etapa,
      orcamentoStatus: item.orcamento?.status,
    })
  ) {
    if (
      item.orcamento?.status === "APROVADO" ||
      item.orcamento?.status === "RECUSADO"
    ) {
      throw new AppError(400, "Orçamento já aprovado/recusado — não editável");
    }
    throw new AppError(
      400,
      "Orçamento só editável em rascunho ou em negociação com o cliente"
    );
  }
  if (!item.manutencaoPlano) {
    throw new AppError(400, "Plano de manutenção ausente");
  }

  const isAdminGerente =
    user.perfil === "ADMIN" || user.perfil === "GERENTE";
  const planoServicos = new Set(
    item.manutencaoPlano.servicos.map((s) => s.descricao.trim().toLowerCase())
  );
  const planoPecas = new Set(
    item.manutencaoPlano.pecas.map((p) => p.produtoId)
  );

  for (const l of input.linhas) {
    if (l.origem === "EXTRA") {
      if (!isAdminGerente) {
        throw new AppError(
          400,
          "Somente Admin/Gerente pode incluir linhas extras fora do plano"
        );
      }
      continue;
    }
    if (l.origem === "SERVICO") {
      if (!planoServicos.has(l.descricao.trim().toLowerCase())) {
        throw new AppError(
          400,
          `Serviço fora do plano: ${l.descricao}`
        );
      }
      continue;
    }
    if (l.origem === "PECA") {
      if (!l.produtoId || !planoPecas.has(l.produtoId)) {
        throw new AppError(400, "Peça fora do plano de manutenção");
      }
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const claimItem = await tx.rmaItem.updateMany({
        where: {
          id: itemId,
          processoId,
          etapa: item.etapa,
        },
        data: { etapa: item.etapa },
      });
      if (claimItem.count === 0) {
        throw new AppError(409, "Item não está em orçamento — atualize a tela");
      }

      const existing = await tx.rmaOrcamento.findUnique({
        where: { rmaItemId: itemId },
      });
      if (
        existing &&
        existing.status !== "RASCUNHO" &&
        existing.status !== "ENVIADO"
      ) {
        throw new AppError(409, "Orçamento já aprovado/recusado — não editável");
      }

      let orcId: string;
      if (existing) {
        const claimOrc = await tx.rmaOrcamento.updateMany({
          where: {
            id: existing.id,
            status: { in: ["RASCUNHO", "ENVIADO"] },
          },
          data: {
            maoDeObra: input.maoDeObra,
            desconto: input.desconto,
            observacaoComercial: input.observacaoComercial?.trim() || null,
            ...(existing.status === "RASCUNHO"
              ? {
                  enviadoEm: null,
                  aprovadoEm: null,
                  aprovadoPorId: null,
                }
              : {}),
          },
        });
        if (claimOrc.count === 0) {
          throw new AppError(
            409,
            "Orçamento alterado por outro usuário — atualize"
          );
        }
        orcId = existing.id;
      } else {
        const created = await tx.rmaOrcamento.create({
          data: {
            rmaItemId: itemId,
            status: "RASCUNHO",
            maoDeObra: input.maoDeObra,
            desconto: input.desconto,
            observacaoComercial: input.observacaoComercial?.trim() || null,
          },
        });
        orcId = created.id;
      }

      await tx.rmaOrcamentoLinha.deleteMany({ where: { orcamentoId: orcId } });
      await tx.rmaOrcamentoLinha.createMany({
        data: input.linhas.map((l) => ({
          orcamentoId: orcId,
          descricao: l.descricao.trim(),
          produtoId: l.produtoId || null,
          quantidade: l.quantidade,
          valorUnitario: l.valorUnitario,
          origem: l.origem,
          tempoMinutos:
            l.tempoMinutos == null || Number.isNaN(Number(l.tempoMinutos))
              ? null
              : Math.max(0, Math.floor(Number(l.tempoMinutos))),
        })),
      });
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      throw new AppError(
        409,
        "Orçamento criado por outro usuário — atualize a tela"
      );
    }
    throw e;
  }

  return obterRma(user, processoId);
}

/** Fecha o orçamento (status interno ENVIADO). Não envia e-mail. */
export async function enviarOrcamentoRmaItem(
  user: AuthUser,
  processoId: string,
  itemId: string
) {
  const proc = await obterRma(user, processoId);
  assertProcessoAberto(proc.status);
  const item = await loadItemNoProcesso(processoId, itemId);
  if (item.etapa !== "AGUARDANDO_ORCAMENTO") {
    throw new AppError(400, "Item não está aguardando orçamento");
  }
  if (!item.orcamento || item.orcamento.linhas.length === 0) {
    throw new AppError(400, "Salve o orçamento com linhas antes de fechar");
  }

  await prisma.$transaction(async (tx) => {
    // Mesma ordem de lock que salvarOrcamento: item → orçamento (evita deadlock)
    const claim = await tx.rmaItem.updateMany({
      where: {
        id: itemId,
        processoId,
        etapa: "AGUARDANDO_ORCAMENTO",
      },
      data: { etapa: "AGUARDANDO_APROVACAO" },
    });
    if (claim.count === 0) {
      throw new AppError(409, "Não foi possível fechar — atualize a tela");
    }
    const claimOrc = await tx.rmaOrcamento.updateMany({
      where: { id: item.orcamento!.id, status: "RASCUNHO" },
      data: { status: "ENVIADO", enviadoEm: new Date() },
    });
    if (claimOrc.count === 0) {
      throw new AppError(409, "Orçamento não está em rascunho — atualize");
    }
  });

  return obterRma(user, processoId);
}

export async function decidirOrcamentoRmaItem(
  user: AuthUser,
  processoId: string,
  itemId: string,
  decisao: "APROVADO" | "RECUSADO",
  observacao?: string | null
) {
  const proc = await obterRma(user, processoId);
  assertProcessoAberto(proc.status);
  if (!podeDecidirAprovacaoRma(user, proc.responsavelComercialId)) {
    throw new AppError(
      403,
      "Apenas o responsável comercial (ou Gerente/Admin) pode registrar a decisão"
    );
  }
  const item = await loadItemNoProcesso(processoId, itemId);
  if (item.etapa !== "AGUARDANDO_APROVACAO" || !item.orcamento) {
    throw new AppError(400, "Não há orçamento aguardando decisão");
  }
  if (item.orcamento.status !== "ENVIADO") {
    throw new AppError(400, "Orçamento precisa estar fechado");
  }

  const total = totalOrcamento(
    item.orcamento.linhas.map((l) => ({
      quantidade: Number(l.quantidade),
      valorUnitario: Number(l.valorUnitario),
    })),
    Number(item.orcamento.maoDeObra),
    Number(item.orcamento.desconto)
  );

  await prisma.$transaction(async (tx) => {
    // Mesma ordem de lock que salvar/enviar: item → orçamento
    const claimItem = await tx.rmaItem.updateMany({
      where: {
        id: itemId,
        processoId,
        etapa: "AGUARDANDO_APROVACAO",
      },
      data:
        decisao === "APROVADO"
          ? {
              etapa: "AGUARDANDO_MANUTENCAO",
              aprovacaoEm: new Date(),
              aprovacaoPorId: user.id,
              aprovacaoObs: observacao?.trim() || null,
              cobrou: total > 0,
              valorCobrado: total > 0 ? total : null,
            }
          : {
              etapa: "NAO_APROVADO",
              status: "SEM_MANUTENCAO",
              aprovacaoEm: new Date(),
              aprovacaoPorId: user.id,
              aprovacaoObs: observacao?.trim() || null,
            },
    });
    if (claimItem.count === 0) {
      throw new AppError(409, "Item não está aguardando aprovação — atualize");
    }

    const claimOrc = await tx.rmaOrcamento.updateMany({
      where: { id: item.orcamento!.id, status: "ENVIADO" },
      data: {
        status: decisao,
        aprovadoEm: new Date(),
        aprovadoPorId: user.id,
        observacaoComercial: observacao?.trim()
          ? `${item.orcamento!.observacaoComercial || ""}\n[Decisão] ${observacao.trim()}`.trim()
          : item.orcamento!.observacaoComercial,
      },
    });
    if (claimOrc.count === 0) {
      throw new AppError(409, "Orçamento já foi decidido — atualize a tela");
    }
  });

  return obterRma(user, processoId);
}

export async function reabrirOrcamentoRmaItem(
  user: AuthUser,
  processoId: string,
  itemId: string
) {
  const proc = await obterRma(user, processoId);
  assertProcessoAberto(proc.status);
  const item = await loadItemNoProcesso(processoId, itemId);
  const bloqueio = mensagemBloqueioReabrirOrcamento({
    orcamentoStatus: item.orcamento?.status,
    etapa: item.etapa,
  });
  if (bloqueio) throw new AppError(400, bloqueio);

  await prisma.$transaction(async (tx) => {
    const claim = await tx.rmaItem.updateMany({
      where: {
        id: itemId,
        processoId,
        etapa: "AGUARDANDO_APROVACAO",
      },
      data: { etapa: "AGUARDANDO_ORCAMENTO" },
    });
    if (claim.count === 0) {
      throw new AppError(409, "Não foi possível reabrir — atualize a tela");
    }
    const claimOrc = await tx.rmaOrcamento.updateMany({
      where: { id: item.orcamento!.id, status: "ENVIADO" },
      data: { status: "RASCUNHO", enviadoEm: null },
    });
    if (claimOrc.count === 0) {
      throw new AppError(409, "Orçamento não está fechado — atualize a tela");
    }
  });

  return obterRma(user, processoId);
}

/** Monta linhas iniciais do orçamento a partir do plano (preços do cadastro). */
export async function sugerirLinhasOrcamentoDoPlano(
  user: AuthUser,
  processoId: string,
  itemId: string
) {
  await obterRma(user, processoId);
  const item = await loadItemNoProcesso(processoId, itemId);
  if (!item.manutencaoPlano) {
    throw new AppError(400, "Plano de manutenção ausente");
  }
  const linhas: Array<{
    descricao: string;
    produtoId: string | null;
    quantidade: number;
    valorUnitario: number;
    origem: "SERVICO" | "PECA";
    tempoMinutos: number | null;
  }> = [];

  for (const s of item.manutencaoPlano.servicos) {
    const tempo = (s as { tempoMinutos?: number | null }).tempoMinutos ?? null;
    linhas.push({
      descricao: s.descricao,
      produtoId: null,
      quantidade: 1,
      valorUnitario: 0,
      origem: "SERVICO",
      tempoMinutos: tempo,
    });
  }
  for (const p of item.manutencaoPlano.pecas) {
    linhas.push({
      descricao: `${p.produto.codigo} — ${p.produto.descricao}`,
      produtoId: p.produtoId,
      quantidade: Number(p.quantidade),
      valorUnitario: Number(p.produto.precoUnitario),
      origem: "PECA",
      tempoMinutos: null,
    });
  }
  return {
    diagnostico: item.diagnostico,
    plano: item.manutencaoPlano,
    linhas,
    orcamento: item.orcamento,
  };
}

const ETAPAS_ORCAMENTO_PAGE = new Set([
  "AGUARDANDO_ORCAMENTO",
  "AGUARDANDO_APROVACAO",
  "AGUARDANDO_MANUTENCAO",
  "NAO_APROVADO",
]);

function moneyBr(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatTempoMinutos(min: number | null | undefined) {
  if (min == null || min < 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function stampSaoPaulo() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
}

function escHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Visão agregada do orçamento do processo (comercial). */
export async function obterOrcamentoAgregadoRma(
  user: AuthUser,
  processoId: string
) {
  const proc = await obterRma(user, processoId);
  const itens = (proc.itens || [])
    .filter(
      (i) =>
        ["EM_ESTOQUE", "SEM_MANUTENCAO"].includes(i.status) &&
        (ETAPAS_ORCAMENTO_PAGE.has(i.etapa || "") || Boolean(i.orcamento))
    )
    .filter(
      (i) =>
        Boolean(i.diagnostico) ||
        Boolean(i.manutencaoPlano) ||
        Boolean(i.orcamento)
    )
    .map((i) => {
      const sugeridas =
        i.manutencaoPlano && (!i.orcamento || i.orcamento.linhas.length === 0)
          ? [
              ...(i.manutencaoPlano.servicos || []).map((s) => ({
                descricao: s.descricao,
                produtoId: null as string | null,
                quantidade: 1,
                valorUnitario: 0,
                origem: "SERVICO" as const,
                tempoMinutos:
                  (s as { tempoMinutos?: number | null }).tempoMinutos ?? null,
              })),
              ...(i.manutencaoPlano.pecas || []).map((p) => ({
                descricao: `${p.produto.codigo} — ${p.produto.descricao}`,
                produtoId: p.produtoId as string | null,
                quantidade: Number(p.quantidade),
                valorUnitario: Number(p.produto.precoUnitario),
                origem: "PECA" as const,
                tempoMinutos: null as number | null,
              })),
            ]
          : null;

      const linhas =
        i.orcamento?.linhas?.map((l) => ({
          descricao: l.descricao,
          produtoId: l.produtoId,
          quantidade: Number(l.quantidade),
          valorUnitario: Number(l.valorUnitario),
          origem: l.origem as "SERVICO" | "PECA" | "EXTRA",
          tempoMinutos:
            (l as { tempoMinutos?: number | null }).tempoMinutos ?? null,
        })) ||
        sugeridas ||
        [];

      const total = totalOrcamento(
        linhas,
        Number(i.orcamento?.maoDeObra ?? 0),
        Number(i.orcamento?.desconto ?? 0)
      );

      return {
        id: i.id,
        status: i.status,
        etapa: i.etapa,
        produto: i.produto,
        unidadeSerie: i.unidadeSerie,
        diagnostico: i.diagnostico,
        manutencaoPlano: i.manutencaoPlano,
        orcamento: i.orcamento
          ? {
              id: i.orcamento.id,
              status: i.orcamento.status,
              desconto: Number(i.orcamento.desconto),
              observacaoComercial: i.orcamento.observacaoComercial,
              enviadoEm: i.orcamento.enviadoEm,
            }
          : null,
        linhas,
        total,
      };
    });

  return {
    processo: {
      id: proc.id,
      status: proc.status,
      nfEntradaNumero: proc.nfEntradaNumero,
      nfSaidaNumero: proc.nfSaidaNumero,
      criadoEm: proc.criadoEm,
      cliente: proc.cliente,
      filial: proc.filial,
      responsavelComercial: proc.responsavelComercial,
    },
    itens,
  };
}

export async function salvarOrcamentoAgregadoRma(
  user: AuthUser,
  processoId: string,
  input: {
    itens: Array<{
      itemId: string;
      desconto?: number;
      observacaoComercial?: string | null;
      linhas: Array<{
        descricao: string;
        produtoId?: string | null;
        quantidade: number;
        valorUnitario: number;
        origem: "SERVICO" | "PECA" | "EXTRA";
        tempoMinutos?: number | null;
      }>;
    }>;
  }
) {
  for (const row of input.itens) {
    await salvarOrcamentoRmaItem(user, processoId, row.itemId, {
      maoDeObra: 0,
      desconto: row.desconto ?? 0,
      observacaoComercial: row.observacaoComercial,
      linhas: row.linhas,
    });
  }
  return obterOrcamentoAgregadoRma(user, processoId);
}

export async function enviarOrcamentoAgregadoRma(
  user: AuthUser,
  processoId: string,
  itemIds: string[]
) {
  const uniq = [...new Set(itemIds)];
  for (const itemId of uniq) {
    await enviarOrcamentoRmaItem(user, processoId, itemId);
  }
  return obterOrcamentoAgregadoRma(user, processoId);
}

export async function exportarOrcamentoRmaPdf(
  user: AuthUser,
  processoId: string
) {
  const data = await obterOrcamentoAgregadoRma(user, processoId);
  const p = data.processo;
  const short = p.id.slice(0, 8);
  const geradoEm = stampSaoPaulo();
  const logoUri = brandAssetDataUri("logo-teep.png");
  const brandMark = logoUri
    ? `<img src="${logoUri}" alt="TEEP" />`
    : `<h1>TEEP Estoque</h1>`;

  const blocos = data.itens
    .map((it) => {
      const sn = it.unidadeSerie?.numeroSerie
        ? ` · N/S ${escHtml(it.unidadeSerie.numeroSerie)}`
        : "";
      const linhasHtml = (it.linhas || [])
        .map((l) => {
          const sub = Number(l.quantidade) * Number(l.valorUnitario);
          return `<tr>
            <td>${escHtml(l.descricao)}${
              l.origem === "SERVICO"
                ? ` <span class="muted">(${formatTempoMinutos(
                    l.tempoMinutos
                  )})</span>`
                : ""
            }</td>
            <td class="num">${l.quantidade}</td>
            <td class="num">${moneyBr(Number(l.valorUnitario))}</td>
            <td class="num">${moneyBr(sub)}</td>
          </tr>`;
        })
        .join("");
      return `
        <section class="item">
          <h2>${escHtml(it.produto.codigo)}${sn}</h2>
          <p class="desc">${escHtml(it.produto.descricao)}</p>
          ${
            it.diagnostico
              ? `<p class="note"><strong>Diagnóstico:</strong> ${escHtml(
                  it.diagnostico.resumoProblema
                )}</p>`
              : ""
          }
          ${
            it.orcamento?.observacaoComercial
              ? `<p class="note"><strong>Obs. comercial:</strong> ${escHtml(
                  it.orcamento.observacaoComercial
                )}</p>`
              : ""
          }
          <table>
            <thead>
              <tr>
                <th>Descrição</th>
                <th class="num">Qtd</th>
                <th class="num">Valor</th>
                <th class="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>${
              linhasHtml ||
              `<tr><td colspan="4" class="muted">Sem linhas</td></tr>`
            }</tbody>
          </table>
          <p class="item-total">Total item: ${moneyBr(it.total)}</p>
        </section>`;
    })
    .join("");

  const totalGeral = data.itens.reduce((a, i) => a + i.total, 0);

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Orçamento RMA ${escHtml(short)} — TEEP Estoque</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; margin: 0; font-size: 10px; }
    .brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 3px solid ${BRAND_COLOR}; padding-bottom: 8px; margin-bottom: 12px; }
    .brand-left { display: flex; align-items: center; gap: 12px; }
    .brand-left img { height: 32px; width: auto; display: block; }
    .brand h1 { margin: 0; font-size: 18px; color: ${BRAND_COLOR}; letter-spacing: 0.02em; }
    .brand .sub { color: #64748b; font-size: 10px; text-align: right; }
    .meta { margin-bottom: 10px; color: #475569; line-height: 1.45; }
    .item { margin-top: 16px; page-break-inside: avoid; }
    .item h2 { margin: 0 0 4px; font-size: 12px; color: ${BRAND_COLOR}; }
    .desc { margin: 0 0 8px; color: #475569; }
    .note { margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f1f5f9; text-align: left; padding: 5px 6px; border-bottom: 1px solid #cbd5e1; font-size: 9px; text-transform: uppercase; letter-spacing: 0.03em; color: #475569; }
    th.num, td.num { text-align: right; }
    td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .item-total { text-align: right; font-weight: 600; margin: 6px 0 0; font-size: 11px; }
    .total { margin-top: 16px; font-size: 13px; font-weight: 700; text-align: right; color: ${BRAND_COLOR}; }
    .muted { color: #94a3b8; }
    .foot { margin-top: 12px; color: #94a3b8; font-size: 9px; }
  </style>
</head>
<body>
  <div class="brand">
    <div class="brand-left">
      ${brandMark}
      <div>
        <div style="font-size:12px;font-weight:600;">Orçamento RMA</div>
        <div style="font-size:9px;color:#64748b;margin-top:2px;">TEEP Estoque</div>
      </div>
    </div>
    <div class="sub">
      Gerado em ${escHtml(geradoEm)} (America/Sao_Paulo)<br/>
      ${escHtml(user.nome)} · ${escHtml(user.perfil)}
    </div>
  </div>
  <div class="meta">
    <div><strong>Cliente:</strong> ${escHtml(p.cliente.nome)}${
      p.cliente.documento ? ` · ${escHtml(p.cliente.documento)}` : ""
    }</div>
    <div><strong>Processo:</strong> ${escHtml(short)} · Estoque ${escHtml(
      p.filial.sigla
    )}${p.filial.nome ? ` — ${escHtml(p.filial.nome)}` : ""}</div>
    ${
      p.nfEntradaNumero
        ? `<div><strong>NF entrada:</strong> ${escHtml(p.nfEntradaNumero)}</div>`
        : ""
    }
  </div>
  ${blocos || `<p class="muted">Nenhum item elegível.</p>`}
  <p class="total">Total geral: ${moneyBr(totalGeral)}</p>
  <div class="foot">TEEP Estoque — orçamento de RMA</div>
</body>
</html>`;

  const buffer = await htmlToPdf(html);
  const filename = `orcamento-rma-${short}.pdf`;
  return { buffer, filename };
}

