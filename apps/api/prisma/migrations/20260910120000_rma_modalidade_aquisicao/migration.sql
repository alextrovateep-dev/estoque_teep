-- Modalidade de aquisição do RMA (NENHUM | CONTRATO | LOCACAO)
ALTER TABLE "rma_processos"
  ADD COLUMN IF NOT EXISTS "modalidade_aquisicao" VARCHAR(20) NOT NULL DEFAULT 'NENHUM';

CREATE INDEX IF NOT EXISTS "rma_processos_modalidade_aquisicao_idx"
  ON "rma_processos"("modalidade_aquisicao");
