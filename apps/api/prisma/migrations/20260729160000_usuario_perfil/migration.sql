-- Perfil do usuário (apelido, telefone, nascimento)
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "apelido" VARCHAR(80);
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "telefone" VARCHAR(20);
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "data_nascimento" DATE;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "perfil_completo" BOOLEAN NOT NULL DEFAULT false;

-- Contas já existentes (ex.: seed admin) não precisam do wizard
UPDATE "usuarios" SET "perfil_completo" = true WHERE "perfil_completo" = false;
