-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN "foto_perfil" VARCHAR(255);

-- AlterTable
ALTER TABLE "produtos" ADD COLUMN "fotos" JSONB NOT NULL DEFAULT '[]';
