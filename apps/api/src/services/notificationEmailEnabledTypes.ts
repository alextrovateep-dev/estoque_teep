import type { AlertaEvento } from "@teep/shared";
import { ALERTA_EMAIL_TYPES } from "./email/emailTypes";

/**
 * Allowlist tipada: tipos de *alerta* que podem gerar e-mail (além do opt-in D33).
 * E-mails de conta (senha provisória) não passam por aqui — são sempre enviados.
 */
export const NOTIFICATION_EMAIL_ENABLED: ReadonlySet<AlertaEvento> = new Set(
  ALERTA_EMAIL_TYPES
);

export function isEmailEnabledForType(tipo: AlertaEvento): boolean {
  return NOTIFICATION_EMAIL_ENABLED.has(tipo);
}
