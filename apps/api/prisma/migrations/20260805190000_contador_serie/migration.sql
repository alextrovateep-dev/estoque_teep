-- Contador de sequencial por produto/ano (geração automática de séries)
CREATE TABLE IF NOT EXISTS "contador_series" (
    "id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "ano" INTEGER NOT NULL,
    "sequencial" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "contador_series_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contador_series_produto_id_ano_key"
  ON "contador_series"("produto_id", "ano");

CREATE INDEX IF NOT EXISTS "contador_series_produto_id_idx"
  ON "contador_series"("produto_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contador_series_produto_id_fkey'
  ) THEN
    ALTER TABLE "contador_series"
      ADD CONSTRAINT "contador_series_produto_id_fkey"
      FOREIGN KEY ("produto_id") REFERENCES "produtos"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
