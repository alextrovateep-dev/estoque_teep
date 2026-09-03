-- Aumenta limite do nome do tipo de operação (cadastros longos de transferência).
ALTER TABLE "tipos_movimentacao" ALTER COLUMN "nome" TYPE VARCHAR(100);
