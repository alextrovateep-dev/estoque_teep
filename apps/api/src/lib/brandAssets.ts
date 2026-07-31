import fs from "node:fs";
import path from "node:path";

const brandDir = path.join(__dirname, "..", "..", "assets", "brand");

/** Caminho absoluto do asset de marca (apps/api/assets/brand). */
export function brandAssetPath(filename: string): string {
  return path.join(brandDir, filename);
}

/** data URI PNG para embutir em HTML de PDF. */
export function brandAssetDataUri(filename: string): string | null {
  const file = brandAssetPath(filename);
  try {
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Buffer PNG para ExcelJS addImage. */
export function brandAssetBuffer(filename: string): Buffer | null {
  const file = brandAssetPath(filename);
  try {
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}
