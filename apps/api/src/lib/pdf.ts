import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { AppError } from "../middleware/error";

const PDF_TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS || 45_000);
/** Um Chromium por vez — Alpine não aguenta fan-out. */
let pdfQueue: Promise<unknown> = Promise.resolve();

function candidateExecutables(): string[] {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  const list: string[] = [];
  if (fromEnv) list.push(fromEnv);

  if (process.platform === "win32") {
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || "";
    list.push(
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe")
    );
  } else if (process.platform === "darwin") {
    list.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    );
  } else {
    list.push(
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable"
    );
  }
  return list;
}

function resolveExecutable(): string {
  for (const p of candidateExecutables()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  throw new AppError(
    503,
    "Chromium/Chrome não encontrado para gerar PDF. Defina PUPPETEER_EXECUTABLE_PATH (em Docker Alpine: /usr/bin/chromium)."
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new AppError(504, `Timeout ao ${label} (${ms}ms)`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function htmlToPdfUnlocked(html: string): Promise<Buffer> {
  const executablePath = resolveExecutable();
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none",
      ],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(PDF_TIMEOUT_MS);
    await page.setContent(html, { waitUntil: "load", timeout: PDF_TIMEOUT_MS });
    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `
        <div style="width:100%;font-size:8px;color:#64748b;padding:0 12mm;display:flex;justify-content:space-between;">
          <span>TEEP Estoque</span>
          <span>Pág. <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
    });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

/** Converte HTML em PDF (A4 landscape) via Puppeteer/Chromium — fila serial. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const run = pdfQueue.then(() =>
    withTimeout(htmlToPdfUnlocked(html), PDF_TIMEOUT_MS + 5_000, "gerar PDF")
  );
  pdfQueue = run.then(
    () => undefined,
    () => undefined
  );
  try {
    return await run;
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = e instanceof Error ? e.message : "Falha ao gerar PDF";
    throw new AppError(500, `Falha ao gerar PDF: ${msg}`);
  }
}
