import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { resolveTransactionalIdentity } from "./mailIdentity";
import {
  escapeHtml,
  normalizeRecipient,
} from "../services/email/recipientUtils";

let transporter: Transporter | null = null;

function smtpEnv() {
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS ?? "";
  return {
    host: process.env.SMTP_HOST?.trim() || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "1",
    user,
    pass,
    passLen: pass.length,
    hasAuth: Boolean(user && pass),
  };
}

function isSmtpAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /535|authentication|auth/i.test(msg);
}

/** Ajuda a diagnosticar senha truncada pelo Docker Compose ($var no .env). */
function logSmtpFailure(err: unknown): void {
  const cfg = smtpEnv();
  const msg = err instanceof Error ? err.message : String(err);
  console.error(
    `[email] SMTP falhou host=${cfg.host} port=${cfg.port} secure=${cfg.secure} user=${cfg.user} passLen=${cfg.passLen} erro=${msg}`
  );
  if (!cfg.hasAuth) {
    console.error(
      "[email] SMTP_HOST definido mas SMTP_USER/SMTP_PASS vazio — verifique .env.production e reinicie a api"
    );
  }
  if (isSmtpAuthError(err)) {
    console.error(
      "[email] Dica 535: servidor rejeitou login (user/senha/porta/secure). Confira SMTP_* no container (passLen acima). Senha com $: use env_file no compose (SMTP_PASS literal) — se POSTGRES_PASSWORD tiver $, escape $$ no .env para DATABASE_URL."
    );
  }
}

function getTransporter(): Transporter | null {
  const cfg = smtpEnv();
  if (!cfg.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.hasAuth ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
  }
  return transporter;
}

/** Envio SMTP síncrono (worker da fila / teste admin). */
export async function deliverPreparedMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  emailType?: string;
  asTest?: boolean;
}): Promise<void> {
  const identity = resolveTransactionalIdentity();
  const to = normalizeRecipient(opts.to);
  const tx = getTransporter();

  if (!tx) {
    console.log(
      `[email:dev] type=${opts.emailType || "?"} channel=transactional to=${to} from=${identity.from} subject=${JSON.stringify(opts.subject)}\n${opts.text}`
    );
    return;
  }

  let info;
  try {
    info = await tx.sendMail({
      from: identity.from,
      replyTo: identity.replyTo,
      envelope: { from: identity.envelopeFrom, to: [to] },
      to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html || `<pre>${escapeHtml(opts.text)}</pre>`,
      headers: opts.asTest ? { "X-TEEP-Email-Test": "1" } : undefined,
    });
  } catch (err) {
    if (isSmtpAuthError(err)) transporter = null;
    logSmtpFailure(err);
    throw err;
  }

  const accepted = info.accepted?.length ?? 0;
  const rejected = info.rejected?.length ?? 0;
  console.log(
    `[email] type=${opts.emailType || "?"} channel=transactional from=${identity.from} replyTo=${identity.replyTo} envelopeFrom=${identity.envelopeFrom} messageId=${info.messageId} accepted=${accepted} rejected=${rejected}`
  );

  if (rejected > 0 || (accepted === 0 && !info.messageId)) {
    throw new Error(
      `SMTP rejeitou envio (accepted=${accepted}, rejected=${rejected})`
    );
  }
}
