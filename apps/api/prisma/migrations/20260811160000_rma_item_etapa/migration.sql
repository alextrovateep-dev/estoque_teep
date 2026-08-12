-- Etapa operacional + aprovação + cobrança por item RMA
ALTER TABLE "rma_itens" ADD COLUMN IF NOT EXISTS "etapa" VARCHAR(30) NOT NULL DEFAULT 'AGUARDANDO_LAUDO';
ALTER TABLE "rma_itens" ADD COLUMN IF NOT EXISTS "aprovacao_em" TIMESTAMPTZ;
ALTER TABLE "rma_itens" ADD COLUMN IF NOT EXISTS "aprovacao_por_id" UUID;
ALTER TABLE "rma_itens" ADD COLUMN IF NOT EXISTS "aprovacao_obs" TEXT;
ALTER TABLE "rma_itens" ADD COLUMN IF NOT EXISTS "cobrou" BOOLEAN;
ALTER TABLE "rma_itens" ADD COLUMN IF NOT EXISTS "valor_cobrado" DECIMAL(12,2);
ALTER TABLE "rma_itens" ADD COLUMN IF NOT EXISTS "nf_cobranca_numero" VARCHAR(60);

-- Legado: mapear a partir do status do item + aprovação do processo
UPDATE "rma_itens" i
SET "etapa" = CASE
  WHEN i."status" IN ('DEVOLVIDO', 'DESCARTADO', 'CANCELADO') THEN 'FINALIZADO'
  WHEN i."status" = 'SEM_MANUTENCAO' THEN 'NAO_APROVADO'
  WHEN p."aprovacao_manutencao" = 'APROVADA' THEN 'AGUARDANDO_MANUTENCAO'
  WHEN p."aprovacao_manutencao" = 'RECUSADA' THEN 'NAO_APROVADO'
  ELSE 'AGUARDANDO_LAUDO'
END
FROM "rma_processos" p
WHERE i."processo_id" = p."id"
  AND i."etapa" = 'AGUARDANDO_LAUDO';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rma_itens_aprovacao_por_id_fkey'
  ) THEN
    ALTER TABLE "rma_itens"
      ADD CONSTRAINT "rma_itens_aprovacao_por_id_fkey"
      FOREIGN KEY ("aprovacao_por_id") REFERENCES "usuarios"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "rma_itens_etapa_idx" ON "rma_itens"("etapa");
