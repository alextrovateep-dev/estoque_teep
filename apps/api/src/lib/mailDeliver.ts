import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { resolveTransactionalIdentity } from "./mailIdentity";
import { readSmtpPass } from "./smtpPass";
import {
  escapeHtml,
  normalizeRecipient,
} from "../services/email/recipientUtils";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "1",
    user: process.env.SMTP_USER?.trim() || "",
    pass: readSmtpPass(),
  };
}

function createTransporter(cfg: SmtpConfig): Transporter {
  const auth =
    cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth,
  });
}

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
  const cfg = smtpConfig();

  if (!cfg) {
    console.log(
      `[email:dev] type=${opts.emailType || "?"} channel=transactional to=${to} from=${identity.from} subject=${JSON.stringify(opts.subject)}\n${opts.text}`
    );
    return;
  }

  let info;
  try {
    info = await createTransporter(cfg).sendMail({
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
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[email] SMTP falhou host=${cfg.host} port=${cfg.port} user=${cfg.user} passLen=${cfg.pass.length} erro=${msg}`
    );
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
