import { ensureRedis } from "./redis";
import { deliverPreparedMail } from "./mailDeliver";

const REDIS_KEY = "teep:email:queue";
const MAX_ATTEMPTS = 5;

export type QueuedMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  emailType?: string;
  asTest?: boolean;
  attempts?: number;
};

/** Serializa drains: cada enqueue agenda um ciclo após o anterior. */
let drainChain: Promise<void> = Promise.resolve();

function scheduleDrain(): void {
  drainChain = drainChain
    .then(() => drainAll())
    .catch((e) => {
      console.error("[emailQueue] drain:", e);
    });
}

function scheduleDelayedRequeue(job: QueuedMail, delayMs: number): void {
  setTimeout(() => {
    void (async () => {
      try {
        const redis = await ensureRedis();
        if (!redis) {
          await deliverPreparedMail(job);
          return;
        }
        await redis.lpush(REDIS_KEY, JSON.stringify(job));
        scheduleDrain();
      } catch (e) {
        console.error("[emailQueue] falha no requeue atrasado:", e);
      }
    })();
  }, delayMs);
}

/**
 * Enfileira e-mail sem bloquear o request path (RNF11).
 * Com Redis: LPUSH + drain serializado (sem orphan).
 * Sem Redis: setImmediate + envio direto.
 */
export function enqueueEmail(payload: QueuedMail): void {
  setImmediate(() => {
    void (async () => {
      try {
        const redis = await ensureRedis();
        if (redis) {
          const job: QueuedMail = { ...payload, attempts: 0 };
          await redis.lpush(REDIS_KEY, JSON.stringify(job));
          scheduleDrain();
          return;
        }
        await deliverPreparedMail(payload);
      } catch (e) {
        console.error("[emailQueue] falha ao enfileirar/enviar:", e);
      }
    })();
  });
}

/** Processa jobs órfãos na subida da API (crash anterior). */
export function startEmailQueueWorker(): void {
  setImmediate(() => scheduleDrain());
}

async function drainAll(): Promise<void> {
  const redis = await ensureRedis();
  if (!redis) return;

  for (;;) {
    const raw = await redis.rpop(REDIS_KEY);
    if (!raw) break;

    let job: QueuedMail;
    try {
      job = JSON.parse(raw) as QueuedMail;
    } catch {
      console.error("[emailQueue] job inválido descartado");
      continue;
    }

    try {
      await deliverPreparedMail(job);
    } catch (e) {
      const attempts = (job.attempts ?? 0) + 1;
      if (attempts < MAX_ATTEMPTS) {
        const delayMs = attempts * 2000;
        console.error(
          `[emailQueue] requeue ${job.to} tentativa ${attempts}/${MAX_ATTEMPTS} em ${delayMs}ms:`,
          e
        );
        // Fora do loop atual — evita hot-retry no mesmo drain
        scheduleDelayedRequeue({ ...job, attempts }, delayMs);
      } else {
        console.error(
          `[emailQueue] desistindo após ${MAX_ATTEMPTS} tentativas:`,
          job.to,
          e
        );
      }
    }
  }
}
