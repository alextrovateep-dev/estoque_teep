import { ALERTA_EVENTO_LABELS } from "@teep/shared";
import {
  ALERTA_EMAIL_TYPES,
  CONTA_EMAIL_TYPES,
  type EmailType,
} from "./emailTypes";
import type { PreparedTransactionalEmail } from "./preparedMail";
import {
  defaultEmailTemplate,
  getEmailSampleAsync,
  listEmailTemplatesForAdmin,
  renderEmailFromTemplate,
  sampleVarsFor,
} from "./emailTemplateStore";

export type EmailSample = {
  type: EmailType;
  label: string;
  build: () => Promise<PreparedTransactionalEmail>;
};

/** Catálogo admin — usa template do banco (ou default). */
export const emailTemplateCatalog: EmailSample[] = [
  ...ALERTA_EMAIL_TYPES.map((type) => ({
    type: type as EmailType,
    label: ALERTA_EVENTO_LABELS[type],
    build: () => getEmailSampleAsync(type),
  })),
  ...CONTA_EMAIL_TYPES.map((type) => ({
    type: type as EmailType,
    label: "Acesso — senha provisória",
    build: () => getEmailSampleAsync(type),
  })),
];

export async function getEmailSample(
  type: EmailType
): Promise<PreparedTransactionalEmail> {
  return getEmailSampleAsync(type);
}

export {
  defaultEmailTemplate,
  listEmailTemplatesForAdmin,
  renderEmailFromTemplate,
  sampleVarsFor,
};
