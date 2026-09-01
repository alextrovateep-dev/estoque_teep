import fs from "fs";

const SMTP_PASS_PREFIX = "SMTP_PASS=";

function firstContentLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#")) ?? ""
  );
}

function parseSmtpPassLine(line: string): string {
  return line.startsWith(SMTP_PASS_PREFIX)
    ? line.slice(SMTP_PASS_PREFIX.length).trim()
    : line;
}

function readPassFromFile(filePath: string): string {
  const line = firstContentLine(fs.readFileSync(filePath, "utf8"));
  return line ? parseSmtpPassLine(line) : "";
}

/** Ordem: SMTP_PASS_B64 → SMTP_PASS_FILE (legado) → SMTP_PASS. */
export function readSmtpPass(): string {
  const b64 = process.env.SMTP_PASS_B64?.trim();
  if (b64) {
    try {
      return Buffer.from(b64, "base64").toString("utf8");
    } catch {
      console.error("[email] SMTP_PASS_B64 inválido");
    }
  }

  const filePath = process.env.SMTP_PASS_FILE?.trim();
  if (filePath) {
    try {
      return readPassFromFile(filePath);
    } catch {
      /* fallback */
    }
  }

  return process.env.SMTP_PASS ?? "";
}
