export type MailIdentity = {
  from: string;
  replyTo: string;
  envelopeFrom: string;
};

/**
 * Identidade SMTP transacional (D37).
 * envelope.from = caixa autenticada (SMTP_USER) quando houver.
 */
export function resolveTransactionalIdentity(): MailIdentity {
  const smtpUser = process.env.SMTP_USER?.trim() || "";
  const from =
    process.env.EMAIL_FROM_TRANSACTIONAL ||
    process.env.SMTP_FROM ||
    "TEEP Estoque <noreply@teep.local>";
  const replyTo =
    process.env.EMAIL_REPLY_TO ||
    process.env.EMAIL_SUPPORT ||
    (smtpUser || "noreply@teep.local");
  const envelopeFrom = smtpUser || extractEmail(from) || "noreply@teep.local";

  const fromDomain = domainOf(extractEmail(from));
  const authDomain = domainOf(envelopeFrom);
  if (fromDomain && authDomain && fromDomain !== authDomain) {
    console.warn(
      `[mailIdentity] From (${fromDomain}) ≠ SMTP auth (${authDomain}) — configure alias no mesmo domínio`
    );
  }

  return { from, replyTo, envelopeFrom };
}

function extractEmail(value: string): string | null {
  const m = value.match(/<([^>]+)>/);
  if (m?.[1]) return m[1].trim().toLowerCase();
  if (value.includes("@")) return value.trim().toLowerCase();
  return null;
}

function domainOf(email: string | null): string | null {
  if (!email) return null;
  const i = email.lastIndexOf("@");
  return i >= 0 ? email.slice(i + 1) : null;
}
