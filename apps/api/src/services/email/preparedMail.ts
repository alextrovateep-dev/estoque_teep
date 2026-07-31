import type { EmailType } from "./emailTypes";

export type PreparedTransactionalEmail = {
  subject: string;
  html: string;
  text: string;
  type: EmailType;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
};
