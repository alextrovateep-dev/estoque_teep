-- Vinculo N:N usuario x filiais
CREATE TABLE IF NOT EXISTS "usuario_filiais" (
  "usuario_id" UUID NOT NULL,
  "filial_id" UUID NOT NULL,
  CONSTRAINT "usuario_filiais_pkey" PRIMARY KEY ("usuario_id", "filial_id"),
  CONSTRAINT "usuario_filiais_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "usuario_filiais_filial_id_fkey"
    FOREIGN KEY ("filial_id") REFERENCES "filiais"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "usuario_filiais_filial_id_idx" ON "usuario_filiais"("filial_id");

-- Migra filial principal existente
INSERT INTO "usuario_filiais" ("usuario_id", "filial_id")
SELECT "id", "filial_id" FROM "usuarios"
WHERE "filial_id" IS NOT NULL
ON CONFLICT DO NOTHING;
