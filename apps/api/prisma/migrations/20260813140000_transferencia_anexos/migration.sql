-- Anexos e NF na transferência (carga)
ALTER TABLE "transferencias" ADD COLUMN IF NOT EXISTS "nota_fiscal_numero" VARCHAR(60);

CREATE TABLE IF NOT EXISTS "transferencia_anexos" (
    "id" UUID NOT NULL,
    "transferencia_id" UUID NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "arquivo" VARCHAR(255) NOT NULL,
    "label" VARCHAR(120),
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transferencia_anexos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "transferencia_anexos_transferencia_id_idx" ON "transferencia_anexos"("transferencia_id");

ALTER TABLE "transferencia_anexos"
  DROP CONSTRAINT IF EXISTS "transferencia_anexos_transferencia_id_fkey";

ALTER TABLE "transferencia_anexos"
  ADD CONSTRAINT "transferencia_anexos_transferencia_id_fkey"
  FOREIGN KEY ("transferencia_id") REFERENCES "transferencias"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
