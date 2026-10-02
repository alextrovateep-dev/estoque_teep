-- Separação baixa estoque e fica SEPARADO (aba Separador).
-- Envio autorizado + NF marca ENVIADO (aba Enviados). Transportadora é opcional.
ALTER TABLE "pedidos_venda"
  ADD COLUMN "liberado_em" TIMESTAMPTZ,
  ADD COLUMN "liberado_por_id" UUID,
  ADD COLUMN "enviado_em" TIMESTAMPTZ,
  ADD COLUMN "transportadora" VARCHAR(120),
  ADD COLUMN "rastreio" VARCHAR(80),
  ADD COLUMN "nf_numero" VARCHAR(60),
  ADD COLUMN "nf_arquivo" VARCHAR(255);

ALTER TABLE "pedidos_venda"
  ADD CONSTRAINT "pedidos_venda_liberado_por_id_fkey"
  FOREIGN KEY ("liberado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fluxo local antigo usava AGUARDANDO após separar.
UPDATE "pedidos_venda"
SET "status" = 'SEPARADO'
WHERE "status" = 'AGUARDANDO';

-- Quem já concluiu o envio (NF) vai para Enviados.
UPDATE "pedidos_venda"
SET "status" = 'ENVIADO'
WHERE "enviado_em" IS NOT NULL
  AND "status" = 'SEPARADO';
