import {
  ALERTA_EVENTO_LABELS,
  type AlertaEvento,
} from "@teep/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { emitAlertaToUser } from "../lib/realtime";
import { buildAlertaEmail } from "./email/builders/alertaEmail";
import { sendPreparedMailAsync } from "./EmailService";
import { isEmailEnabledForType } from "./notificationEmailEnabledTypes";

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

type Preferencias = Partial<Record<AlertaEvento, boolean>>;

function parsePrefs(raw: unknown): Preferencias {
  if (!raw || typeof raw !== "object") return {};
  return raw as Preferencias;
}

export type CreateNotificationInput = {
  tipo: AlertaEvento;
  titulo?: string;
  mensagem: string;
  meta?: Record<string, unknown>;
  /** Chave de dedup (ex.: produtoCodigo|filialNome) */
  dedupeKey?: string | null;
  /** Se false, só DB + socket (sem e-mail) */
  tryEmail?: boolean;
};

/**
 * Fanout: para cada usuário com tick do evento → DB → socket → e-mail opcional.
 * `tryEmail: false` = só inbox/toast (usado quando o e-mail sai por outro canal,
 * ex.: lista `emailsDestino` do alerta de retorno).
 * Nunca await no request path.
 */
export function emitirNotificacaoEvento(
  input: CreateNotificationInput
): void {
  setImmediate(() => {
    void fanout(input).catch((e) =>
      console.error("[NotificationService] fanout:", e)
    );
  });
}

async function fanout(input: CreateNotificationInput): Promise<void> {
  const titulo = input.titulo || ALERTA_EVENTO_LABELS[input.tipo];
  const users = await prisma.usuario.findMany({
    where: { ativo: true },
    select: {
      id: true,
      email: true,
      nome: true,
      receberAlertasEmail: true,
      alertasEmail: true,
    },
  });

  for (const u of users) {
    const prefs = parsePrefs(u.alertasEmail);
    if (prefs[input.tipo] !== true) continue;

    await createNotificationForUser({
      usuarioId: u.id,
      email: u.email,
      nome: u.nome,
      receberAlertasEmail: u.receberAlertasEmail,
      tipo: input.tipo,
      titulo,
      mensagem: input.mensagem,
      meta: input.meta,
      dedupeKey: input.dedupeKey,
      tryEmail: input.tryEmail !== false,
    });
  }
}

async function createNotificationForUser(opts: {
  usuarioId: string;
  email: string;
  nome: string;
  receberAlertasEmail: boolean;
  tipo: AlertaEvento;
  titulo: string;
  mensagem: string;
  meta?: Record<string, unknown>;
  dedupeKey?: string | null;
  tryEmail: boolean;
}): Promise<void> {
  const row = await prisma.$transaction(async (tx) => {
    if (opts.dedupeKey) {
      // Serializa criações do mesmo usuário+tipo+chave (evita race do find+create)
      const lockKey = `${opts.usuarioId}:${opts.tipo}:${opts.dedupeKey}`;
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
      `;

      const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
      const recent = await tx.notificacao.findFirst({
        where: {
          usuarioId: opts.usuarioId,
          tipo: opts.tipo,
          dedupeKey: opts.dedupeKey,
          criadoEm: { gte: since },
        },
        select: { id: true },
      });
      if (recent) return null;
    }

    return tx.notificacao.create({
      data: {
        usuarioId: opts.usuarioId,
        tipo: opts.tipo,
        titulo: opts.titulo,
        mensagem: opts.mensagem,
        meta: (opts.meta ?? {}) as Prisma.InputJsonValue,
        dedupeKey: opts.dedupeKey || null,
      },
    });
  });

  if (!row) return;

  const em = row.criadoEm.toISOString();
  emitAlertaToUser(opts.usuarioId, {
    id: row.id,
    evento: opts.tipo,
    titulo: opts.titulo,
    mensagem: opts.mensagem,
    meta: opts.meta,
    em,
  });

  if (!opts.tryEmail) return;
  if (!opts.receberAlertasEmail) return;
  if (!isEmailEnabledForType(opts.tipo)) return;

  try {
    const prepared = await buildAlertaEmail({
      type: opts.tipo,
      destinatarioNome: opts.nome,
      mensagem: opts.mensagem,
      titulo: opts.titulo,
    });
    sendPreparedMailAsync(opts.email, prepared);
  } catch (e) {
    console.error(
      "[NotificationService] e-mail falhou (notificação mantida):",
      e
    );
  }
}

/** Só in-app (DB + socket), sem e-mail — destinatário único (não consulta preferências). */
export function createInAppNotification(
  usuarioId: string,
  input: Omit<CreateNotificationInput, "tryEmail">
): void {
  setImmediate(() => {
    void (async () => {
      try {
        const u = await prisma.usuario.findUnique({
          where: { id: usuarioId },
          select: {
            id: true,
            email: true,
            nome: true,
            receberAlertasEmail: true,
            ativo: true,
          },
        });
        if (!u || !u.ativo) return;
        await createNotificationForUser({
          usuarioId: u.id,
          email: u.email,
          nome: u.nome,
          receberAlertasEmail: u.receberAlertasEmail,
          tipo: input.tipo,
          titulo: input.titulo || ALERTA_EVENTO_LABELS[input.tipo],
          mensagem: input.mensagem,
          meta: input.meta,
          dedupeKey: input.dedupeKey,
          tryEmail: false,
        });
      } catch (e) {
        console.error("[NotificationService] createInApp:", e);
      }
    })();
  });
}

export async function listarNotificacoes(
  usuarioId: string,
  opts?: { take?: number; onlyUnread?: boolean }
) {
  const take = Math.min(opts?.take ?? 30, 100);
  const where = {
    usuarioId,
    ...(opts?.onlyUnread ? { lida: false } : {}),
  };
  const [total, naoLidas, data] = await Promise.all([
    prisma.notificacao.count({ where: { usuarioId } }),
    prisma.notificacao.count({ where: { usuarioId, lida: false } }),
    prisma.notificacao.findMany({
      where,
      orderBy: { criadoEm: "desc" },
      take,
    }),
  ]);
  return { data, total, naoLidas, take };
}

export async function marcarLida(usuarioId: string, id: string) {
  const n = await prisma.notificacao.findFirst({
    where: { id, usuarioId },
  });
  if (!n) return null;
  return prisma.notificacao.update({
    where: { id },
    data: { lida: true },
  });
}

export async function marcarTodasLidas(usuarioId: string) {
  const r = await prisma.notificacao.updateMany({
    where: { usuarioId, lida: false },
    data: { lida: true },
  });
  return { atualizadas: r.count };
}
