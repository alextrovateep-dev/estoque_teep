-- Acelera a checagem de número de NF já usado (por operação).
CREATE INDEX IF NOT EXISTS "movimentacoes_nota_fiscal_numero_idx"
  ON "movimentacoes"("nota_fiscal_numero");

CREATE INDEX IF NOT EXISTS "transferencias_nota_fiscal_numero_idx"
  ON "transferencias"("nota_fiscal_numero");

CREATE INDEX IF NOT EXISTS "rma_processos_nf_entrada_numero_idx"
  ON "rma_processos"("nf_entrada_numero");

CREATE INDEX IF NOT EXISTS "rma_processos_nf_saida_numero_idx"
  ON "rma_processos"("nf_saida_numero");

CREATE INDEX IF NOT EXISTS "rma_processos_nf_cobranca_numero_idx"
  ON "rma_processos"("nf_cobranca_numero");

CREATE INDEX IF NOT EXISTS "rma_itens_nf_cobranca_numero_idx"
  ON "rma_itens"("nf_cobranca_numero");
