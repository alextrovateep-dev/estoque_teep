-- Drop dual-storage columns (fonte única = rma_anexos)
ALTER TABLE "rma_processos" DROP COLUMN IF EXISTS "nf_entrada_arquivo";
ALTER TABLE "rma_processos" DROP COLUMN IF EXISTS "nf_saida_arquivo";

-- Histórico consultável: anexos substituídos ficam ativo=false
ALTER TABLE "rma_anexos" ADD COLUMN IF NOT EXISTS "ativo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "rma_anexos" ADD COLUMN IF NOT EXISTS "substituido_em" TIMESTAMPTZ;

-- Em dev: se já houver duplicatas, mantém o mais recente ativo
WITH ranked_nf AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY processo_id, tipo
      ORDER BY criado_em DESC, id DESC
    ) AS rn
  FROM "rma_anexos"
  WHERE item_id IS NULL
    AND tipo IN ('NF_ENTRADA', 'NF_SAIDA', 'NF_COBRANCA')
)
UPDATE "rma_anexos" a
SET
  ativo = false,
  substituido_em = COALESCE(a.substituido_em, NOW())
FROM ranked_nf r
WHERE a.id = r.id
  AND r.rn > 1
  AND a.ativo = true;

WITH ranked_laudo AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY processo_id, item_id, tipo
      ORDER BY criado_em DESC, id DESC
    ) AS rn
  FROM "rma_anexos"
  WHERE tipo = 'LAUDO'
    AND item_id IS NOT NULL
)
UPDATE "rma_anexos" a
SET
  ativo = false,
  substituido_em = COALESCE(a.substituido_em, NOW())
FROM ranked_laudo r
WHERE a.id = r.id
  AND r.rn > 1
  AND a.ativo = true;

CREATE INDEX IF NOT EXISTS "rma_anexos_processo_id_tipo_ativo_idx"
  ON "rma_anexos"("processo_id", "tipo", "ativo");

-- Um NF ativo por tipo no processo
CREATE UNIQUE INDEX IF NOT EXISTS "rma_anexos_nf_ativo_uidx"
  ON "rma_anexos"("processo_id", "tipo")
  WHERE "ativo" = true
    AND "item_id" IS NULL
    AND "tipo" IN ('NF_ENTRADA', 'NF_SAIDA', 'NF_COBRANCA');

-- Um laudo ativo por item
CREATE UNIQUE INDEX IF NOT EXISTS "rma_anexos_laudo_ativo_uidx"
  ON "rma_anexos"("processo_id", "item_id", "tipo")
  WHERE "ativo" = true
    AND "tipo" = 'LAUDO'
    AND "item_id" IS NOT NULL;
