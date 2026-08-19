import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getMaxUploadBytes, publicUrlToAbs } from "./uploads";

/** Quadro do laudo no PDF (px CSS ≈ enquadramento). */
export const PDF_FOTO_MAX_LADO = 960;
export const PDF_FOTO_JPEG_QUALITY = 72;

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

/**
 * JPEG reduzido para embutir no PDF (quadro ~960px no lado maior).
 * O arquivo original no disco não é alterado.
 */
export async function imageBufferToPdfJpegDataUri(
  buf: Buffer
): Promise<string | null> {
  if (!buf.length || buf.length > getMaxUploadBytes()) return null;
  try {
    const out = await sharp(buf)
      .rotate()
      .resize({
        width: PDF_FOTO_MAX_LADO,
        height: PDF_FOTO_MAX_LADO,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: PDF_FOTO_JPEG_QUALITY })
      .toBuffer();
    if (!out.length) return null;
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Lê a foto do disco e devolve JPEG reduzido para o PDF.
 */
export async function uploadPublicUrlToPdfImageDataUri(
  publicUrl: string
): Promise<string | null> {
  const abs = publicUrlToAbs(publicUrl);
  if (!abs) return null;
  const ext = path.extname(abs).toLowerCase();
  if (!IMAGE_EXT.has(ext)) return null;
  try {
    if (!fs.existsSync(abs)) return null;
    return imageBufferToPdfJpegDataUri(fs.readFileSync(abs));
  } catch {
    return null;
  }
}

export async function mapPdfImageDataUris(
  urls: string[]
): Promise<Map<string, string | null>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const out = new Map<string, string | null>();
  for (const url of unique) {
    out.set(url, await uploadPublicUrlToPdfImageDataUri(url));
  }
  return out;
}
