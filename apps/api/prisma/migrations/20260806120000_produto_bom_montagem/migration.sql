-- BOM + montagem (baixa por árvore)

ALTER TABLE "tipos_movimentacao"
  ADD COLUMN IF NOT EXISTS "baixa_por_arvore" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "produto_componentes" (
    "id" UUID NOT NULL,
    "produto_pai_id" UUID NOT NULL,
    "produto_filho_id" UUID NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "fantasma" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "produto_componentes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_bom_pai_filho"
  ON "produto_componentes"("produto_pai_id", "produto_filho_id");

CREATE INDEX IF NOT EXISTS "produto_componentes_produto_pai_id_idx"
  ON "produto_componentes"("produto_pai_id");

CREATE INDEX IF NOT EXISTS "produto_componentes_produto_filho_id_idx"
  ON "produto_componentes"("produto_filho_id");

ALTER TABLE "produto_componentes"
  DROP CONSTRAINT IF EXISTS "produto_componentes_produto_pai_id_fkey";
ALTER TABLE "produto_componentes"
  ADD CONSTRAINT "produto_componentes_produto_pai_id_fkey"
  FOREIGN KEY ("produto_pai_id") REFERENCES "produtos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "produto_componentes"
  DROP CONSTRAINT IF EXISTS "produto_componentes_produto_filho_id_fkey";
ALTER TABLE "produto_componentes"
  ADD CONSTRAINT "produto_componentes_produto_filho_id_fkey"
  FOREIGN KEY ("produto_filho_id") REFERENCES "produtos"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "movimentacoes"
  ADD COLUMN IF NOT EXISTS "filial_componentes_id" UUID,
  ADD COLUMN IF NOT EXISTS "movimentacao_montagem_id" UUID;

CREATE INDEX IF NOT EXISTS "movimentacoes_filial_componentes_id_idx"
  ON "movimentacoes"("filial_componentes_id");

CREATE INDEX IF NOT EXISTS "movimentacoes_movimentacao_montagem_id_idx"
  ON "movimentacoes"("movimentacao_montagem_id");

ALTER TABLE "movimentacoes"
  DROP CONSTRAINT IF EXISTS "movimentacoes_filial_componentes_id_fkey";
ALTER TABLE "movimentacoes"
  ADD CONSTRAINT "movimentacoes_filial_componentes_id_fkey"
  FOREIGN KEY ("filial_componentes_id") REFERENCES "filiais"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "movimentacoes"
  DROP CONSTRAINT IF EXISTS "movimentacoes_movimentacao_montagem_id_fkey";
ALTER TABLE "movimentacoes"
  ADD CONSTRAINT "movimentacoes_movimentacao_montagem_id_fkey"
  FOREIGN KEY ("movimentacao_montagem_id") REFERENCES "movimentacoes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
