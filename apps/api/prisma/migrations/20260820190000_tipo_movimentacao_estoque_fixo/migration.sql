-- Código único + estoques fixos no tipo de movimentação
ALTER TABLE "tipos_movimentacao"
  ADD COLUMN "codigo" VARCHAR(30),
  ADD COLUMN "filial_id" UUID,
  ADD COLUMN "filial_destino_id" UUID;

-- Backfill código a partir do nome (slug curto); garante unicidade
UPDATE "tipos_movimentacao" t
SET "codigo" = LEFT(
  UPPER(
    REGEXP_REPLACE(
      TRANSLATE(
        t."nome",
        'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
      ),
      '[^A-Za-z0-9]+',
      '-',
      'g'
    )
  ),
  28
)
WHERE t."codigo" IS NULL;

-- Evita colisão se dois nomes gerarem o mesmo slug
UPDATE "tipos_movimentacao" t
SET "codigo" = LEFT(t."codigo", 24) || '-' || LEFT(REPLACE(t."id"::text, '-', ''), 4)
WHERE t."id" IN (
  SELECT a."id"
  FROM "tipos_movimentacao" a
  INNER JOIN "tipos_movimentacao" b
    ON a."codigo" = b."codigo" AND a."id" > b."id"
);

ALTER TABLE "tipos_movimentacao"
  ALTER COLUMN "codigo" SET NOT NULL;

CREATE UNIQUE INDEX "tipos_movimentacao_codigo_key" ON "tipos_movimentacao"("codigo");
CREATE INDEX "tipos_movimentacao_filial_id_idx" ON "tipos_movimentacao"("filial_id");
CREATE INDEX "tipos_movimentacao_filial_destino_id_idx" ON "tipos_movimentacao"("filial_destino_id");

ALTER TABLE "tipos_movimentacao"
  ADD CONSTRAINT "tipos_movimentacao_filial_id_fkey"
  FOREIGN KEY ("filial_id") REFERENCES "filiais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tipos_movimentacao"
  ADD CONSTRAINT "tipos_movimentacao_filial_destino_id_fkey"
  FOREIGN KEY ("filial_destino_id") REFERENCES "filiais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
