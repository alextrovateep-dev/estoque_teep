ALTER TABLE "movimentacoes" ADD COLUMN IF NOT EXISTS "nota_fiscal_numero" VARCHAR(60);
ALTER TABLE "movimentacoes" ADD COLUMN IF NOT EXISTS "nota_fiscal_arquivo" VARCHAR(255);
