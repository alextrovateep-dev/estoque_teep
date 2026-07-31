import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { resolveTransactionalIdentity } from "./mailIdentity";
import {
  escapeHtml,
  normalizeRecipient,
} from "../services/email/recipientUtils";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "1",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            }
          : undefined,
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

  const info = await tx.sendMail({
    from: identity.from,
    replyTo: identity.replyTo,
    envelope: { from: identity.envelopeFrom, to: [to] },
    to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html || `<pre>${escapeHtml(opts.text)}</pre>`,
    headers: opts.asTest ? { "X-TEEP-Email-Test": "1" } : undefined,
  });

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
