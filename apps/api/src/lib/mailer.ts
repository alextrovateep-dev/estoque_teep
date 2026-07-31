/** @deprecated use EmailService / mailDeliver */
export type { QueuedMail as MailPayload } from "./emailQueue";
export { deliverPreparedMail as sendMail } from "./mailDeliver";
