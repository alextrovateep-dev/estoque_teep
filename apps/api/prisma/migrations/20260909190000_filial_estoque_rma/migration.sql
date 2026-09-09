-- Flag de depósito RMA (como estoque_acabados), sem depender da sigla "RMA".
ALTER TABLE "filiais" ADD COLUMN IF NOT EXISTS "estoque_rma" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: estoques que já usavam a convenção antiga de sigla RMA.
UPDATE "filiais"
SET "estoque_rma" = true
WHERE UPPER(TRIM("sigla")) = 'RMA' AND "ativo" = true;
