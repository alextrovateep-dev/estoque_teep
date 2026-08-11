import {
  DIAS_ALERTA_RETORNO_DEFAULT,
  ALERTA_EVENTO_LABELS,
} from "@teep/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { emitirNotificacaoEvento } from "./NotificationService";
import { buildAlertaEmail } from "./email/builders/alertaEmail";
import { sendPreparedMailAsync } from "./EmailService";
import { isEmailEnabledForType } from "./notificationEmailEnabledTypes";
import { qtyRestanteParaAlertas } from "./retornoVinculoHelper";

const TZ = "America/Sao_Paulo";

function parseDiasAlerta(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DIAS_ALERTA_RETORNO_DEFAULT];
  const nums = raw
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 365);
  return nums.length > 0
    ? [...new Set(nums)].sort((a, b) => a - b)
    : [...DIAS_ALERTA_RETORNO_DEFAULT];
}

/** YYYY-MM-DD civil em America/Sao_Paulo. */
function ymdSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Date @ UTC midnight representing the civil SP calendar day (DATE column). */
function civilDateSaoPaulo(d: Date): Date {
  const [y, m, day] = ymdSaoPaulo(d).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
}

function addDaysCivilSaoPaulo(base: Date, days: number): Date {
  const start = civilDateSaoPaulo(base);
  start.setUTCDate(start.getUTCDate() + days);
  return start;
}

function todayCivilSaoPaulo(): Date {
  return civilDateSaoPaulo(new Date());
}

function formatDataMovimentoSp(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    dateStyle: "short",
  }).format(d);
}

/** Agenda disparos a partir de dataMovimento (calendário America/Sao_Paulo). */
export async function agendarAlertasRetorno(
  tx: Prisma.TransactionClient,
  opts: {
    movimentacaoId: string;
    dataMovimento: Date;
    diasAlerta: unknown;
    emails: string[];
  }
): Promise<void> {
  const emails = opts.emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) return;
  const dias = parseDiasAlerta(opts.diasAlerta);
  const emailsDestino = emails.join(", ");

  for (const d of dias) {
    const existing = await tx.alertaRetornoAgenda.findUnique({
      where: {
        movimentacaoId_dias: {
          movimentacaoId: opts.movimentacaoId,
          dias: d,
        },
      },
    });
    if (existing) {
      if (!existing.enviadoEm) {
        await tx.alertaRetornoAgenda.update({
          where: { id: existing.id },
          data: {
            emailsDestino,
            agendadoPara: addDaysCivilSaoPaulo(opts.dataMovimento, d),
            canceladoEm: null,
          },
        });
      }
      continue;
    }
    await tx.alertaRetornoAgenda.create({
      data: {
        movimentacaoId: opts.movimentacaoId,
        dias: d,
        agendadoPara: addDaysCivilSaoPaulo(opts.dataMovimento, d),
        emailsDestino,
      },
    });
  }
}

/** Cancela agendas pendentes da saída (quando qty restante zera). */
export async function cancelarAlertasRetornoPendentes(
  tx: Prisma.TransactionClient,
  movimentacaoId: string
): Promise<number> {
  const r = await tx.alertaRetornoAgenda.updateMany({
    where: {
      movimentacaoId,
      enviadoEm: null,
      canceladoEm: null,
    },
    data: { canceladoEm: new Date() },
  });
  return r.count;
}

/**
 * Reabre agendas canceladas (ainda não enviadas) após estorno de retorno
 * com qty ainda em aberto.
 */
export async function reabrirAlertasRetornoPendentes(
  tx: Prisma.TransactionClient,
  movimentacaoId: string
): Promise<number> {
  const r = await tx.alertaRetornoAgenda.updateMany({
    where: {
      movimentacaoId,
      enviadoEm: null,
      canceladoEm: { not: null },
    },
    data: { canceladoEm: null },
  });
  return r.count;
}

/**
 * Após retorno CONCLUIDO: cancela alertas só se qty restante (só CONCLUIDO) == 0.
 * Retornos PENDENTE não cancelam alertas.
 */
export async function syncAlertasAposRetorno(
  tx: Prisma.TransactionClient,
  saidaId: string
): Promise<void> {
  const saida = await tx.movimentacao.findUnique({
    where: { id: saidaId },
    select: { id: true, quantidade: true },
  });
  if (!saida) return;
  const restante = await qtyRestanteParaAlertas(tx, saida);
  if (restante <= 1e-9) {
    await cancelarAlertasRetornoPendentes(tx, saidaId);
  }
}

/**
 * Após rejeição/estorno: reabre alertas se ainda há qty em aberto (só CONCLUIDO).
 */
export async function syncAlertasAposLiberacaoSaida(
  tx: Prisma.TransactionClient,
  saidaId: string
): Promise<void> {
  const saida = await tx.movimentacao.findUnique({
    where: { id: saidaId },
    select: { id: true, quantidade: true },
  });
  if (!saida) return;
  const restante = await qtyRestanteParaAlertas(tx, saida);
  if (restante > 1e-9) {
    await reabrirAlertasRetornoPendentes(tx, saidaId);
  } else {
    await cancelarAlertasRetornoPendentes(tx, saidaId);
  }
}

/**
 * Processa agendas vencidas (job). Claim atômico evita double-send.
 */
export async function processarAlertasRetornoVencidos(): Promise<{
  enviados: number;
  erros: number;
}> {
  const hoje = todayCivilSaoPaulo();
  const candidatos = await prisma.alertaRetornoAgenda.findMany({
    where: {
      agendadoPara: { lte: hoje },
      enviadoEm: null,
      canceladoEm: null,
      movimentacao: { status: "CONCLUIDO" },
    },
    select: { id: true, movimentacaoId: true },
    take: 200,
    orderBy: { agendadoPara: "asc" },
  });

  let enviados = 0;
  let erros = 0;

  for (const cand of candidatos) {
    let claimed = false;
    let sideEffectsStarted = false;
    try {
      const saida = await prisma.movimentacao.findUnique({
        where: { id: cand.movimentacaoId },
        select: { id: true, quantidade: true, status: true },
      });
      if (!saida || saida.status !== "CONCLUIDO") continue;
      const restante = await qtyRestanteParaAlertas(prisma, saida);
      if (restante <= 1e-9) {
        await prisma.alertaRetornoAgenda.updateMany({
          where: { id: cand.id, enviadoEm: null, canceladoEm: null },
          data: { canceladoEm: new Date() },
        });
        continue;
      }

      // Claim: só um worker marca enviadoEm
      const claimResult = await prisma.alertaRetornoAgenda.updateMany({
        where: {
          id: cand.id,
          enviadoEm: null,
          canceladoEm: null,
        },
        data: { enviadoEm: new Date() },
      });
      if (claimResult.count === 0) continue;
      claimed = true;

      const agenda = await prisma.alertaRetornoAgenda.findUnique({
        where: { id: cand.id },
        include: {
          movimentacao: {
            include: {
              produto: { select: { codigo: true, descricao: true } },
              cliente: { select: { nome: true } },
              filial: { select: { sigla: true, nome: true } },
              tipo: { select: { nome: true } },
            },
          },
        },
      });
      if (!agenda) continue;

      const m = agenda.movimentacao;
      const titulo = `${ALERTA_EVENTO_LABELS.ALERTA_RETORNO_MOVIMENTACAO} · ${m.produto.codigo}`;
      const mensagem = [
        `Alerta de retorno (${agenda.dias} dias) — ${m.tipo.nome}.`,
        `Produto: ${m.produto.codigo} — ${m.produto.descricao}.`,
        `Qtd saída: ${Number(m.quantidade)} · ainda em aberto: ${restante}.`,
        m.cliente ? `Cliente: ${m.cliente.nome}.` : null,
        `Filial: ${m.filial.sigla} (${m.filial.nome}).`,
        `Movimento: ${m.id.slice(0, 8)}… em ${formatDataMovimentoSp(m.dataMovimento)}.`,
        m.notaFiscalNumero ? `NF: ${m.notaFiscalNumero}.` : null,
        "Verifique se o equipamento já retornou ou providencie o retorno.",
      ]
        .filter(Boolean)
        .join(" ");

      sideEffectsStarted = true;
      // Sino para quem tem o tick; e-mail NÃO vai no fanout (evita duplicata com emailsDestino).
      emitirNotificacaoEvento({
        tipo: "ALERTA_RETORNO_MOVIMENTACAO",
        titulo,
        mensagem,
        meta: {
          movimentacaoId: m.id,
          dias: agenda.dias,
          produtoCodigo: m.produto.codigo,
          qtyRestante: restante,
        },
        dedupeKey: `${m.id}|${agenda.dias}`,
        tryEmail: false,
      });

      // Canal operacional: e-mail só para a lista digitada no lançamento.
      if (isEmailEnabledForType("ALERTA_RETORNO_MOVIMENTACAO")) {
        const emails = [
          ...new Set(
            agenda.emailsDestino
              .split(",")
              .map((e) => e.trim().toLowerCase())
              .filter(Boolean)
          ),
        ];
        if (emails.length > 0) {
          const prepared = await buildAlertaEmail({
            type: "ALERTA_RETORNO_MOVIMENTACAO",
            destinatarioNome: "Financeiro",
            mensagem,
            titulo,
          });
          for (const to of emails) {
            sendPreparedMailAsync(to, prepared);
          }
        }
      }

      enviados += 1;
    } catch (e) {
      erros += 1;
      // Só libera claim se ainda não houve notificação/e-mail (evita double-send)
      if (claimed && !sideEffectsStarted) {
        await prisma.alertaRetornoAgenda
          .updateMany({
            where: { id: cand.id, enviadoEm: { not: null } },
            data: { enviadoEm: null },
          })
          .catch(() => undefined);
      }
      console.error("[alertaRetorno] falha ao processar", cand.id, e);
    }
  }

  return { enviados, erros };
}
