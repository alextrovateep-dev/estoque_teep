CREATE INDEX IF NOT EXISTS "pedidos_venda_status_atualizado_em_idx"
  ON "pedidos_venda" ("status", "atualizado_em");

CREATE INDEX IF NOT EXISTS "pedidos_venda_status_dt_venda_idx"
  ON "pedidos_venda" ("status", "dt_venda");
