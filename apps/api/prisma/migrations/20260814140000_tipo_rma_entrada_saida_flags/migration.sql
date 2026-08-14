-- Flags configuráveis: qual tipo ENTRADA/SAIDA o módulo RMA usa (em vez de nome fixo)

ALTER TABLE "tipos_movimentacao"
  ADD COLUMN "rma_entrada_estoque" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rma_saida_cliente" BOOLEAN NOT NULL DEFAULT false;

-- Bootstrap: tipos sistema já existentes
UPDATE "tipos_movimentacao"
SET "rma_entrada_estoque" = true
WHERE "nome" = 'Entrada RMA' AND "operacao" = 'ENTRADA';

UPDATE "tipos_movimentacao"
SET "rma_saida_cliente" = true
WHERE "nome" = 'Saída RMA' AND "operacao" = 'SAIDA';

-- No máximo um tipo com cada flag
CREATE UNIQUE INDEX "tipos_movimentacao_rma_entrada_estoque_key"
  ON "tipos_movimentacao" ("rma_entrada_estoque")
  WHERE "rma_entrada_estoque" = true;

CREATE UNIQUE INDEX "tipos_movimentacao_rma_saida_cliente_key"
  ON "tipos_movimentacao" ("rma_saida_cliente")
  WHERE "rma_saida_cliente" = true;
