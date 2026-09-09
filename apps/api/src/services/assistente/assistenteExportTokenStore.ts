import { randomBytes } from "node:crypto";
import { ensureRedis } from "../../lib/redis";

export type AssistenteExportFormat = "pdf" | "xlsx";

export type AssistenteExportEntry = {
  userId: string;
  buffer: Buffer;
  filename: string;
  format: AssistenteExportFormat;
  label: string;
  expiresAt: number;
};

const TTL_MS = 5 * 60_000;
const TTL_SEC = Math.ceil(TTL_MS / 1000);
const REDIS_PREFIX = "assistente:export:";

/** Fallback local (dev / sem Redis). */
const memoryStore = new Map<string, AssistenteExportEntry>();

function purgeExpiredMemory(now = Date.now()): void {
  for (const [token, entry] of memoryStore) {
    if (entry.expiresAt <= now) memoryStore.delete(token);
  }
}

type RedisPayload = {
  userId: string;
  bufferB64: string;
  filename: string;
  format: AssistenteExportFormat;
  label: string;
};

/** Guarda buffer efêmero (TTL 5 min). Prefer Redis; fallback memória. */
export async function putAssistenteExport(
  entry: Omit<AssistenteExportEntry, "expiresAt">
): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const redis = await ensureRedis();
  if (redis) {
    const payload: RedisPayload = {
      userId: entry.userId,
      bufferB64: entry.buffer.toString("base64"),
      filename: entry.filename,
      format: entry.format,
      label: entry.label,
    };
    await redis.setex(
      `${REDIS_PREFIX}${token}`,
      TTL_SEC,
      JSON.stringify(payload)
    );
    return token;
  }
  purgeExpiredMemory();
  memoryStore.set(token, { ...entry, expiresAt: Date.now() + TTL_MS });
  return token;
}

/**
 * Consome o token (uso único). Retorna null se inexistente, expirado ou de outro usuário.
 */
export async function takeAssistenteExport(
  token: string,
  userId: string
): Promise<AssistenteExportEntry | null> {
  const redis = await ensureRedis();
  if (redis) {
    const key = `${REDIS_PREFIX}${token}`;
    const raw = await redis.get(key);
    if (!raw) return null;
    await redis.del(key);
    try {
      const p = JSON.parse(raw) as RedisPayload;
      if (p.userId !== userId) return null;
      if (p.format !== "pdf" && p.format !== "xlsx") return null;
      return {
        userId: p.userId,
        buffer: Buffer.from(p.bufferB64, "base64"),
        filename: p.filename,
        format: p.format,
        label: p.label,
        expiresAt: Date.now() + TTL_MS,
      };
    } catch {
      return null;
    }
  }

  purgeExpiredMemory();
  const entry = memoryStore.get(token);
  if (!entry) return null;
  if (entry.userId !== userId) return null;
  memoryStore.delete(token);
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}
