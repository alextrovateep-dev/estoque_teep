-- Alerta de mínimo: null = todos os estoques; uuid = só aquela filial
ALTER TABLE "produtos"
  ADD COLUMN "estoque_minimo_filial_id" UUID;

ALTER TABLE "produtos"
  ADD CONSTRAINT "produtos_estoque_minimo_filial_id_fkey"
  FOREIGN KEY ("estoque_minimo_filial_id")
  REFERENCES "filiais"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
