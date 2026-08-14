-- Tempo do tecnico nos servicos + snapshot nas linhas do orcamento.
-- Migrar etapa legada AGUARDANDO_LAUDO para AGUARDANDO_RECEBIMENTO.

ALTER TABLE "rma_manutencao_servicos"
  ADD COLUMN IF NOT EXISTS "tempo_minutos" INTEGER;

ALTER TABLE "rma_orcamento_linhas"
  ADD COLUMN IF NOT EXISTS "tempo_minutos" INTEGER;

UPDATE "rma_itens"
SET "etapa" = 'AGUARDANDO_RECEBIMENTO'
WHERE "etapa" = 'AGUARDANDO_LAUDO';
