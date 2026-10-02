-- Pedido: contrato, data prevista, frete cobrado, anexos
ALTER TABLE "pedidos_venda" ADD COLUMN IF NOT EXISTS "tipo_contrato" VARCHAR(30);
ALTER TABLE "pedidos_venda" ADD COLUMN IF NOT EXISTS "data_prevista_entrega" DATE;
ALTER TABLE "pedidos_venda" ADD COLUMN IF NOT EXISTS "frete_cobrado" BOOLEAN;

CREATE TABLE IF NOT EXISTS "pedido_venda_anexos" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "arquivo" VARCHAR(255) NOT NULL,
    "label" VARCHAR(120),
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedido_venda_anexos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pedido_venda_anexos_pedido_id_idx" ON "pedido_venda_anexos"("pedido_id");
CREATE INDEX IF NOT EXISTS "pedido_venda_anexos_pedido_id_tipo_idx" ON "pedido_venda_anexos"("pedido_id", "tipo");

DO $$ BEGIN
  ALTER TABLE "pedido_venda_anexos"
    ADD CONSTRAINT "pedido_venda_anexos_pedido_id_fkey"
    FOREIGN KEY ("pedido_id") REFERENCES "pedidos_venda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- RMA: frete na liberação / envio
ALTER TABLE "rma_processos" ADD COLUMN IF NOT EXISTS "frete_modalidade" VARCHAR(30);
ALTER TABLE "rma_processos" ADD COLUMN IF NOT EXISTS "transportadora" VARCHAR(120);
ALTER TABLE "rma_processos" ADD COLUMN IF NOT EXISTS "frete_cobrado" BOOLEAN;

-- RMA: quem autorizou a troca antecipada
ALTER TABLE "rma_itens" ADD COLUMN IF NOT EXISTS "substituicao_autorizada_por_id" UUID;

DO $$ BEGIN
  ALTER TABLE "rma_itens"
    ADD CONSTRAINT "rma_itens_substituicao_autorizada_por_id_fkey"
    FOREIGN KEY ("substituicao_autorizada_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
