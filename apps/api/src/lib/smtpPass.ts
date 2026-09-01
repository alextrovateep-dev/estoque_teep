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

/** SMTP_PASS_FILE (.smtp.env montado) ou SMTP_PASS no ambiente. */
export function readSmtpPass(): string {
  const filePath = process.env.SMTP_PASS_FILE?.trim();
  if (filePath) {
    try {
      const line = firstContentLine(fs.readFileSync(filePath, "utf8"));
      if (line) return parseSmtpPassLine(line);
    } catch {
      /* usa SMTP_PASS se o arquivo não existir */
    }
  }
  return process.env.SMTP_PASS ?? "";
}
