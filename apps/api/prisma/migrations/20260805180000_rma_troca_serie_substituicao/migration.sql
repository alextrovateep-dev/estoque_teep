-- Série substituta na troca RMA (peça boa enviada ao cliente)
ALTER TABLE "rma_itens"
  ADD COLUMN IF NOT EXISTS "unidade_serie_substituicao_id" UUID;

CREATE INDEX IF NOT EXISTS "rma_itens_unidade_serie_substituicao_id_idx"
  ON "rma_itens"("unidade_serie_substituicao_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rma_itens_unidade_serie_substituicao_id_fkey'
  ) THEN
    ALTER TABLE "rma_itens"
      ADD CONSTRAINT "rma_itens_unidade_serie_substituicao_id_fkey"
      FOREIGN KEY ("unidade_serie_substituicao_id")
      REFERENCES "unidades_serie"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
