-- Campos de contato da filial não eram usados pelo sistema (só cadastro).
ALTER TABLE "filiais" DROP COLUMN IF EXISTS "responsavel";
ALTER TABLE "filiais" DROP COLUMN IF EXISTS "email_contato";
