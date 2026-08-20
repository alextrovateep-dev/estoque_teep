-- CNPJ do contato eGestor + vínculo opcional com Cliente TEEP (obrigatório na separação)
ALTER TABLE "pedidos_venda"
  ADD COLUMN "documento_contato" VARCHAR(20),
  ADD COLUMN "cliente_id" UUID;

CREATE INDEX "pedidos_venda_cliente_id_idx" ON "pedidos_venda"("cliente_id");

ALTER TABLE "pedidos_venda"
  ADD CONSTRAINT "pedidos_venda_cliente_id_fkey"
  FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
