import { Prisma } from "@prisma/client";
import {
  RMA_CHECKLIST_CAMPO_TIPOS,
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
import { obterRma, podeDecidirAprovacaoRma } from "./rmaService";

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
    if (
      !["AGUARDANDO_RECEBIMENTO", "AGUARDANDO_LAUDO"].includes(item.etapa)
    ) {
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
    if (
      !["AGUARDANDO_RECEBIMENTO", "AGUARDANDO_LAUDO"].includes(item.etapa)
    ) {
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
    servicos: Array<{ descricao: string; ordem?: number }>;
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

  if (!["AGUARDANDO_RECEBIMENTO", "AGUARDANDO_LAUDO"].includes(item.etapa)) {
    throw new AppError(
      400,
      "Diagnóstico/plano só podem ser editados na etapa de recebimento"
    );
  }

  if (concluir) {
    const recv = item.checklistExecucoes.find((e) => e.tipo === "RECEBIMENTO");
    if (!recv || recv.status !== "CONCLUIDO") {
      throw new AppError(
        400,
        "Conclua o checklist de recebimento antes de enviar ao orçamento"
      );
    }
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
      throw new AppError(400, "Uma ou mais peças são inválidas/inativas");
    }
  }

  await prisma.$transaction(async (tx) => {
    const claimEtapa = await tx.rmaItem.updateMany({
      where: {
        id: itemId,
        processoId,
        etapa: { in: ["AGUARDANDO_RECEBIMENTO", "AGUARDANDO_LAUDO"] },
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
    }>;
  }
) {
  const proc = await obterRma(user, processoId);
  assertProcessoAberto(proc.status);
  const item = await loadItemNoProcesso(processoId, itemId);

  if (item.etapa !== "AGUARDANDO_ORCAMENTO") {
    throw new AppError(400, "Orçamento só editável na etapa de orçamento");
  }
  if (
    item.orcamento?.status === "APROVADO" ||
    item.orcamento?.status === "ENVIADO"
  ) {
    throw new AppError(400, "Orçamento já enviado/aprovado — não editável");
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
          etapa: "AGUARDANDO_ORCAMENTO",
        },
        data: { etapa: "AGUARDANDO_ORCAMENTO" },
      });
      if (claimItem.count === 0) {
        throw new AppError(409, "Item não está em orçamento — atualize a tela");
      }

      const existing = await tx.rmaOrcamento.findUnique({
        where: { rmaItemId: itemId },
      });
      if (existing && existing.status !== "RASCUNHO") {
        throw new AppError(409, "Orçamento já enviado/aprovado — não editável");
      }

      let orcId: string;
      if (existing) {
        const claimOrc = await tx.rmaOrcamento.updateMany({
          where: { id: existing.id, status: "RASCUNHO" },
          data: {
            maoDeObra: input.maoDeObra,
            desconto: input.desconto,
            observacaoComercial: input.observacaoComercial?.trim() || null,
            enviadoEm: null,
            aprovadoEm: null,
            aprovadoPorId: null,
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
    throw new AppError(400, "Salve o orçamento com linhas antes de enviar");
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
      throw new AppError(409, "Não foi possível enviar — atualize a tela");
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
    throw new AppError(400, "Orçamento precisa estar enviado");
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
  }> = [];

  for (const s of item.manutencaoPlano.servicos) {
    linhas.push({
      descricao: s.descricao,
      produtoId: null,
      quantidade: 1,
      valorUnitario: 0,
      origem: "SERVICO",
    });
  }
  for (const p of item.manutencaoPlano.pecas) {
    linhas.push({
      descricao: `${p.produto.codigo} — ${p.produto.descricao}`,
      produtoId: p.produtoId,
      quantidade: Number(p.quantidade),
      valorUnitario: Number(p.produto.precoUnitario),
      origem: "PECA",
    });
  }
  return {
    diagnostico: item.diagnostico,
    plano: item.manutencaoPlano,
    linhas,
    orcamento: item.orcamento,
  };
}
