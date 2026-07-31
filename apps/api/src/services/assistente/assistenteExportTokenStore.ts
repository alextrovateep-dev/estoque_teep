import { randomBytes } from "node:crypto";

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
const store = new Map<string, AssistenteExportEntry>();

function purgeExpired(now = Date.now()): void {
  for (const [token, entry] of store) {
    if (entry.expiresAt <= now) store.delete(token);
  }
}

/** Guarda buffer efêmero (TTL 5 min). Retorna token opaco. */
export function putAssistenteExport(
  entry: Omit<AssistenteExportEntry, "expiresAt">
): string {
  purgeExpired();
  const token = randomBytes(24).toString("base64url");
  store.set(token, { ...entry, expiresAt: Date.now() + TTL_MS });
  return token;
}

/**
 * Consome o token (uso único). Retorna null se inexistente, expirado ou de outro usuário.
 */
export function takeAssistenteExport(
  token: string,
  userId: string
): AssistenteExportEntry | null {
  purgeExpired();
  const entry = store.get(token);
  if (!entry) return null;
  if (entry.userId !== userId) return null;
  store.delete(token);
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}
