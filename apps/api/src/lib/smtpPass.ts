import fs from "fs";

/**
 * Senha SMTP sem passar pelo parser do Docker Compose.
 * Compose expande $var em --env-file e env_file — use SMTP_PASS_FILE (.smtp.env montado).
 */
export function readSmtpPass(): string {
  const path = process.env.SMTP_PASS_FILE?.trim();
  if (path) {
    try {
      const raw = fs.readFileSync(path, "utf8");
      const line =
        raw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l && !l.startsWith("#")) ?? "";
      if (!line) return "";
      const eq = line.indexOf("=");
      if (eq > 0 && line.slice(0, eq).trim() === "SMTP_PASS") {
        return line.slice(eq + 1).trim();
      }
      return line;
    } catch (e) {
      console.error(`[email] não leu SMTP_PASS_FILE (${path}):`, e);
    }
  }
  return process.env.SMTP_PASS ?? "";
}
