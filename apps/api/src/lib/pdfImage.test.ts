import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  PDF_FOTO_MAX_LADO,
  imageBufferToPdfJpegDataUri,
} from "./pdfImage";

describe("imageBufferToPdfJpegDataUri", () => {
  it("reduz imagem grande para o quadro do PDF", async () => {
    const big = await sharp({
      create: {
        width: 2400,
        height: 1800,
        channels: 3,
        background: { r: 40, g: 80, b: 120 },
      },
    })
      .png()
      .toBuffer();
    const uri = await imageBufferToPdfJpegDataUri(big);
    assert.ok(uri?.startsWith("data:image/jpeg;base64,"));
    const jpeg = Buffer.from(uri!.slice("data:image/jpeg;base64,".length), "base64");
    assert.ok(jpeg.length < big.length);
    const meta = await sharp(jpeg).metadata();
    assert.ok((meta.width ?? 0) <= PDF_FOTO_MAX_LADO);
    assert.ok((meta.height ?? 0) <= PDF_FOTO_MAX_LADO);
  });
});
