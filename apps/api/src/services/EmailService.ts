import { enqueueEmail } from "../lib/emailQueue";
import { deliverPreparedMail } from "../lib/mailDeliver";
import type { PreparedTransactionalEmail } from "./email/preparedMail";
import { normalizeRecipient } from "./email/recipientUtils";

/**
 * Único ponto de envio a partir de PreparedMail (Build ≠ Send).
 * Enfileira para não bloquear o caller.
 */
export function sendPreparedMailAsync(
  to: string,
  prepared: PreparedTransactionalEmail,
  opts?: { asTest?: boolean }
): void {
  const recipient = normalizeRecipient(to);
  const subject = opts?.asTest
    ? `[TESTE] ${prepared.subject}`
    : prepared.subject;

  enqueueEmail({
    to: recipient,
    subject,
    text: prepared.text,
    html: prepared.html,
    emailType: prepared.type,
    asTest: Boolean(opts?.asTest),
  });
}

/** Envio síncrono (teste admin). */
export async function sendPreparedMailNow(
  to: string,
  prepared: PreparedTransactionalEmail,
  opts?: { asTest?: boolean }
): Promise<void> {
  await deliverPreparedMail({
    to,
    subject: opts?.asTest ? `[TESTE] ${prepared.subject}` : prepared.subject,
    text: prepared.text,
    html: prepared.html,
    emailType: prepared.type,
    asTest: Boolean(opts?.asTest),
  });
}

export { deliverPreparedMail };
