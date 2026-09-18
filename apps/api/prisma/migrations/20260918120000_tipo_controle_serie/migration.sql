-- Número de série configurável por tipo de operação
-- PRODUTO = segue produto.controla_serie | OBRIGATORIO = sempre pede | NAO_USA = nunca pede
ALTER TABLE "tipos_movimentacao"
  ADD COLUMN "controle_serie" VARCHAR(20) NOT NULL DEFAULT 'PRODUTO';
