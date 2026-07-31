-- Endereço e nome fantasia para cadastro completo via CNPJ
ALTER TABLE "clientes" ALTER COLUMN "nome" TYPE VARCHAR(150);

ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "nome_fantasia" VARCHAR(120);
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "cep" VARCHAR(9);
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "logradouro" VARCHAR(120);
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "numero" VARCHAR(20);
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "complemento" VARCHAR(80);
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "bairro" VARCHAR(80);
