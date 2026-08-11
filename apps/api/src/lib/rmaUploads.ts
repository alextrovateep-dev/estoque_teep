import fs from "fs";
import path from "path";
import {
  getUploadRoot,
  publicUrlToAbs,
  randomHash12,
  toPublicUrl,
} from "./uploads";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXT_RE = "(jpg|png|gif|webp|pdf|doc|docx)";
const NF_EXTS = new Set(["jpg", "png", "gif", "webp", "pdf"]);
const LAUDO_EXTS = new Set(["jpg", "png", "gif", "webp", "pdf", "doc", "docx"]);
const NF_EXT_RE = "(jpg|png|gif|webp|pdf)";

export type RmaAnexoTipo =
  | "NF_ENTRADA"
  | "NF_SAIDA"
  | "NF_COBRANCA"
  | "LAUDO"
  | "OUTRO";

export type RmaPromoteResult = {
  publicUrl: string;
  tmpPublicUrl: string;
  archivedPublicUrl: string | null;
  /** Path em `atual/` antes do archive (para restore no rollback). */
  previousAtualPublicUrl: string | null;
};

/** Garante pastas base de RMA. */
export function ensureRmaUploadDirs(): void {
  const root = getUploadRoot();
  fs.mkdirSync(path.join(root, "rma", "_tmp"), { recursive: true });
}

export function extFromPublicUrl(publicUrl: string): string | null {
  const m = publicUrl.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Valida extensão permitida para o tipo de anexo. */
export function assertExtForRmaTipo(tipo: RmaAnexoTipo, ext: string): void {
  const e = ext.toLowerCase().replace(/^\./, "");
  if (tipo === "LAUDO" || tipo === "OUTRO") {
    if (!LAUDO_EXTS.has(e)) {
      throw new Error(
        "Laudo: use PDF, Word (doc/docx), JPEG, PNG, GIF ou WebP"
      );
    }
    return;
  }
  if (!NF_EXTS.has(e)) {
    throw new Error("Nota fiscal: use PDF, JPEG, PNG, GIF ou WebP");
  }
}

export function isValidRmaTmpPath(
  publicUrl: string,
  userId: string
): boolean {
  if (!UUID_RE.test(userId)) return false;
  return new RegExp(
    `^/uploads/rma/_tmp/${userId}-[0-9a-f]{12}\\.${EXT_RE}$`,
    "i"
  ).test(publicUrl);
}

/** Path canônico do arquivo atual (consulta / download). */
export function isValidRmaAtualPath(
  publicUrl: string,
  processoId?: string
): boolean {
  const proc =
    processoId && UUID_RE.test(processoId) ? processoId : "[0-9a-f-]{36}";
  const re = new RegExp(
    `^/uploads/rma/${proc}/atual/(?:nf-entrada|nf-saida|nf-cobranca)\\.${NF_EXT_RE}$` +
      `|^/uploads/rma/${proc}/atual/laudos/[0-9a-f-]{36}\\.${EXT_RE}$` +
      `|^/uploads/rma/${proc}/atual/outros/[0-9a-f]{12}\\.${EXT_RE}$`,
    "i"
  );
  return re.test(publicUrl);
}

export function isValidRmaHistoricoPath(
  publicUrl: string,
  processoId?: string
): boolean {
  const proc =
    processoId && UUID_RE.test(processoId) ? processoId : "[0-9a-f-]{36}";
  return new RegExp(
    `^/uploads/rma/${proc}/historico/[A-Za-z0-9._-]+\\.${EXT_RE}$`,
    "i"
  ).test(publicUrl);
}

/** Aceita tmp (upload recente), atual ou histórico do processo. */
export function isValidRmaStoredPath(
  publicUrl: string,
  opts?: { userId?: string; processoId?: string }
): boolean {
  if (opts?.userId && isValidRmaTmpPath(publicUrl, opts.userId)) return true;
  if (isValidRmaAtualPath(publicUrl, opts?.processoId)) return true;
  if (isValidRmaHistoricoPath(publicUrl, opts?.processoId)) return true;
  return false;
}

function slotRelPath(tipo: RmaAnexoTipo, itemId?: string | null): string {
  switch (tipo) {
    case "NF_ENTRADA":
      return "nf-entrada";
    case "NF_SAIDA":
      return "nf-saida";
    case "NF_COBRANCA":
      return "nf-cobranca";
    case "LAUDO":
      if (!itemId || !UUID_RE.test(itemId)) {
        throw new Error("itemId inválido para laudo");
      }
      return path.join("laudos", itemId);
    case "OUTRO":
      return path.join("outros", randomHash12());
    default:
      throw new Error(`Tipo de anexo RMA inválido: ${tipo}`);
  }
}

function historicoStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDirForFile(absFile: string): void {
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
}

function archiveExistingSlot(
  processoId: string,
  slotRelWithoutExt: string
): { archivedPublicUrl: string; previousAtualPublicUrl: string } | null {
  const root = getUploadRoot();
  const dir = path.join(
    root,
    "rma",
    processoId,
    "atual",
    path.dirname(slotRelWithoutExt)
  );
  const stem = path.basename(slotRelWithoutExt);
  if (!fs.existsSync(dir)) return null;

  let last: {
    archivedPublicUrl: string;
    previousAtualPublicUrl: string;
  } | null = null;

  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(`${stem}.`)) continue;
    const oldAbs = path.join(dir, name);
    const previousAtualPublicUrl = toPublicUrl(oldAbs);
    const prefix =
      stem.length === 36 && dir.endsWith(`${path.sep}laudos`)
        ? `laudo_${name}`
        : name;
    const histAbs = path.join(
      root,
      "rma",
      processoId,
      "historico",
      `${historicoStamp()}_${prefix}`
    );
    ensureDirForFile(histAbs);
    fs.renameSync(oldAbs, histAbs);
    last = {
      archivedPublicUrl: toPublicUrl(histAbs),
      previousAtualPublicUrl,
    };
  }
  return last;
}

/**
 * Move arquivo de `_tmp` para `atual/` do processo.
 * Se já existir arquivo no slot, arquiva em `historico/` (não apaga).
 */
export function promoteRmaTmpToAtual(input: {
  processoId: string;
  tipo: RmaAnexoTipo;
  itemId?: string | null;
  tmpPublicUrl: string;
}): RmaPromoteResult {
  if (!UUID_RE.test(input.processoId)) {
    throw new Error("processoId inválido");
  }
  const tmpAbs = publicUrlToAbs(input.tmpPublicUrl);
  if (!tmpAbs || !fs.existsSync(tmpAbs)) {
    throw new Error("Arquivo temporário de anexo RMA não encontrado");
  }

  const ext = path.extname(tmpAbs).replace(/^\./, "").toLowerCase();
  if (!ext) throw new Error("Extensão de arquivo inválida");
  assertExtForRmaTipo(input.tipo, ext);

  const slot = slotRelPath(input.tipo, input.itemId);
  const archived =
    input.tipo === "OUTRO"
      ? null
      : archiveExistingSlot(input.processoId, slot);

  const atualAbs = path.join(
    getUploadRoot(),
    "rma",
    input.processoId,
    "atual",
    `${slot}.${ext}`
  );
  ensureDirForFile(atualAbs);
  fs.renameSync(tmpAbs, atualAbs);
  return {
    publicUrl: toPublicUrl(atualAbs),
    tmpPublicUrl: input.tmpPublicUrl,
    archivedPublicUrl: archived?.archivedPublicUrl ?? null,
    previousAtualPublicUrl: archived?.previousAtualPublicUrl ?? null,
  };
}

/**
 * Desfaz um promote: devolve o novo arquivo ao `_tmp` e restaura o
 * arquivo arquivado em `atual/` (best-effort).
 */
export function rollbackRmaPromote(placed: RmaPromoteResult): void {
  try {
    const atualAbs = publicUrlToAbs(placed.publicUrl);
    const tmpAbs = publicUrlToAbs(placed.tmpPublicUrl);
    if (atualAbs && tmpAbs && fs.existsSync(atualAbs)) {
      ensureDirForFile(tmpAbs);
      if (fs.existsSync(tmpAbs)) {
        fs.unlinkSync(tmpAbs);
      }
      fs.renameSync(atualAbs, tmpAbs);
    }

    if (placed.archivedPublicUrl && placed.previousAtualPublicUrl) {
      const histAbs = publicUrlToAbs(placed.archivedPublicUrl);
      const prevAbs = publicUrlToAbs(placed.previousAtualPublicUrl);
      if (histAbs && prevAbs && fs.existsSync(histAbs)) {
        ensureDirForFile(prevAbs);
        if (fs.existsSync(prevAbs)) {
          fs.unlinkSync(prevAbs);
        }
        fs.renameSync(histAbs, prevAbs);
      }
    }
  } catch (e) {
    console.error("[rma] falha ao reverter promote de anexo", e);
  }
}

/** Grava buffer em `/uploads/rma/_tmp/{userId}-{hash}.{ext}`. */
export function writeRmaTmpFile(
  userId: string,
  buffer: Buffer,
  ext: string
): string {
  if (!UUID_RE.test(userId)) throw new Error("userId inválido");
  ensureRmaUploadDirs();
  const filename = `${userId}-${randomHash12()}.${ext}`;
  const abs = path.join(getUploadRoot(), "rma", "_tmp", filename);
  fs.writeFileSync(abs, buffer);
  return toPublicUrl(abs);
}
