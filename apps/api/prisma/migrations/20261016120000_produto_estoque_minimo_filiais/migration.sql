-- Mínimo por estoques marcados (lista). Vazio = não monitora.
ALTER TABLE "produtos"
  ADD COLUMN "estoque_minimo_filial_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

UPDATE "produtos"
SET "estoque_minimo_filial_ids" = ARRAY["estoque_minimo_filial_id"]
WHERE "estoque_minimo_filial_id" IS NOT NULL;

ALTER TABLE "produtos" DROP CONSTRAINT "produtos_estoque_minimo_filial_id_fkey";
ALTER TABLE "produtos" DROP COLUMN "estoque_minimo_filial_id";
