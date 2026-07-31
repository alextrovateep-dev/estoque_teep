import fs from "fs";
import path from "path";
import crypto from "crypto";

const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 10 * 1024 * 1024);

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function getUploadRoot(): string {
  const configured = process.env.UPLOAD_DIR;
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  return path.resolve(process.cwd(), "uploads");
}

export function ensureUploadDirs(): void {
  const root = getUploadRoot();
  fs.mkdirSync(path.join(root, "fotos-perfil"), { recursive: true });
  fs.mkdirSync(path.join(root, "conteudo", "produtos"), { recursive: true });
  fs.mkdirSync(path.join(root, "notas-fiscais"), { recursive: true });
  fs.mkdirSync(path.join(root, "movimentacao-anexos"), { recursive: true });
}

export function getMaxUploadBytes(): number {
  return MAX_BYTES;
}

export function extFromMime(mime: string): string | null {
  return MIME_EXT[mime] || null;
}

export function isAllowedMime(mime: string, allowPdf = false): boolean {
  if (MIME_EXT[mime] === "pdf") return allowPdf;
  return Boolean(MIME_EXT[mime]) && mime !== "application/pdf";
}

/** Valida magic bytes básicos (não confiar só no Content-Type). */
export function detectImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return "image/gif";
  }
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function detectPdfMime(buf: Buffer): string | null {
  if (buf.length < 5) return null;
  if (buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

/** Imagem ou PDF (nota fiscal). */
export function detectUploadMime(
  buf: Buffer,
  allowPdf: boolean
): string | null {
  const img = detectImageMime(buf);
  if (img) return img;
  if (allowPdf) return detectPdfMime(buf);
  return null;
}

export function randomHash12(): string {
  return crypto.randomBytes(6).toString("hex");
}

/** Path HTTP relativo a partir do path absoluto no disco. */
export function toPublicUrl(absPath: string): string {
  const root = getUploadRoot();
  const rel = path.relative(root, absPath).split(path.sep).join("/");
  return `/uploads/${rel}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Converte `/uploads/...` em path absoluto; rejeita path traversal. */
export function publicUrlToAbs(publicUrl: string): string | null {
  if (!publicUrl.startsWith("/uploads/")) return null;
  const rel = publicUrl.slice("/uploads/".length);
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) return null;
  const root = path.resolve(getUploadRoot());
  const abs = path.resolve(root, rel);
  const outside = path.relative(root, abs);
  if (outside.startsWith("..") || path.isAbsolute(outside)) return null;
  return abs;
}

export function deleteUploadBestEffort(publicUrl: string | null | undefined): void {
  if (!publicUrl) return;
  const abs = publicUrlToAbs(publicUrl);
  if (!abs) return;
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e) {
    console.error("[uploads] falha ao apagar", publicUrl, e);
  }
}

/** Apaga avatares órfãos do usuário, mantendo os paths informados. */
export function purgeOrphanAvatarFiles(
  usuarioId: string,
  keepUrls: Array<string | null | undefined>
): void {
  if (!UUID_RE.test(usuarioId)) return;
  const dir = path.join(getUploadRoot(), "fotos-perfil");
  if (!fs.existsSync(dir)) return;
  const keep = new Set<string>();
  for (const u of keepUrls) {
    if (!u) continue;
    const abs = publicUrlToAbs(u);
    if (abs) keep.add(path.basename(abs));
  }
  const prefix = `${usuarioId}-`;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    if (keep.has(name)) continue;
    deleteUploadBestEffort(`/uploads/fotos-perfil/${name}`);
  }
}

/** Apaga fotos órfãs do produto, mantendo os paths informados. */
export function purgeOrphanProdutoFiles(
  produtoId: string,
  keepUrls: string[]
): void {
  if (!UUID_RE.test(produtoId)) return;
  const dir = path.join(getUploadRoot(), "conteudo", "produtos", produtoId);
  if (!fs.existsSync(dir)) return;
  const keep = new Set<string>();
  for (const u of keepUrls) {
    const abs = publicUrlToAbs(u);
    if (abs) keep.add(path.basename(abs));
  }
  for (const name of fs.readdirSync(dir)) {
    if (keep.has(name)) continue;
    deleteUploadBestEffort(`/uploads/conteudo/produtos/${produtoId}/${name}`);
  }
}

export function isValidUploadPath(
  publicUrl: string,
  kind: "perfil" | "produto" | "nota-fiscal" | "documento",
  entityId?: string
): boolean {
  if (kind === "perfil") {
    if (entityId) {
      if (!UUID_RE.test(entityId)) return false;
      return new RegExp(
        `^/uploads/fotos-perfil/${entityId}-[0-9a-f]{12}\\.(jpg|png|gif|webp)$`,
        "i"
      ).test(publicUrl);
    }
    return /^\/uploads\/fotos-perfil\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/i.test(
      publicUrl
    );
  }
  if (kind === "nota-fiscal") {
    if (!entityId || !UUID_RE.test(entityId)) return false;
    return new RegExp(
      `^/uploads/notas-fiscais/${entityId}-[0-9a-f]{12}\\.(jpg|png|gif|webp|pdf)$`,
      "i"
    ).test(publicUrl);
  }
  if (kind === "documento") {
    if (!entityId || !UUID_RE.test(entityId)) return false;
    return new RegExp(
      `^/uploads/movimentacao-anexos/${entityId}-[0-9a-f]{12}\\.(jpg|png|gif|webp|pdf)$`,
      "i"
    ).test(publicUrl);
  }
  if (!entityId || !UUID_RE.test(entityId)) return false;
  return new RegExp(
    `^/uploads/conteudo/produtos/${entityId}/[0-9a-f]{12}\\.(jpg|png|gif|webp)$`,
    "i"
  ).test(publicUrl);
}
