export { EMAIL_TYPES, type EmailType } from "./emailTypes";
export type { PreparedTransactionalEmail } from "./preparedMail";
export { buildAlertaEmail } from "./builders/alertaEmail";
export {
  emailTemplateCatalog,
  getEmailSample,
} from "./emailTemplateCatalog";
export { normalizeRecipient, escapeHtml } from "./recipientUtils";
