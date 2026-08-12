-- Remove aprovação no processo: fonte de verdade é rma_itens.etapa
DROP INDEX IF EXISTS "rma_processos_aprovacao_manutencao_idx";

ALTER TABLE "rma_processos" DROP CONSTRAINT IF EXISTS "rma_processos_aprovacao_por_id_fkey";

ALTER TABLE "rma_processos" DROP COLUMN IF EXISTS "aprovacao_manutencao";
ALTER TABLE "rma_processos" DROP COLUMN IF EXISTS "aprovacao_em";
ALTER TABLE "rma_processos" DROP COLUMN IF EXISTS "aprovacao_por_id";
ALTER TABLE "rma_processos" DROP COLUMN IF EXISTS "aprovacao_obs";
