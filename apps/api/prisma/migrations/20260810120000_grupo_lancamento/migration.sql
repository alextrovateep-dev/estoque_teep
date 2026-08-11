-- Agrupa várias movimentações (SKUs) do mesmo lançamento/nota.
ALTER TABLE "movimentacoes" ADD COLUMN IF NOT EXISTS "grupo_lancamento_id" UUID;
CREATE INDEX IF NOT EXISTS "movimentacoes_grupo_lancamento_id_idx" ON "movimentacoes"("grupo_lancamento_id");
