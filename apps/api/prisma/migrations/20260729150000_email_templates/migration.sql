-- Templates de e-mail transacional editáveis pelo Admin
CREATE TABLE IF NOT EXISTS "email_templates" (
  "type" VARCHAR(60) PRIMARY KEY,
  "subject" VARCHAR(200) NOT NULL,
  "body_text" TEXT NOT NULL,
  "preheader" VARCHAR(200),
  "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
