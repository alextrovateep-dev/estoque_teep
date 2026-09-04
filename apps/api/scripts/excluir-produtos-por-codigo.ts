/**
 * Remove produtos por código se estiverem livres (sem árvore, movimentação, etc.).
 *
 * Uso (na pasta apps/api, com DATABASE_URL do .env):
 *   pnpm exec tsx scripts/excluir-produtos-por-codigo.ts          # dry-run
 *   pnpm exec tsx scripts/excluir-produtos-por-codigo.ts --apply  # executa
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  avaliarExclusaoProduto,
  excluirProdutoSeLivre,
} from "../src/services/produtoExclusaoService";

const CODIGOS = [
  "MP-RES-3K3",
  "MP-RES-10K",
  "MP-RL-2.5V",
  "MP-PCI-2X8",
  "MP-OPTO-4N25",
  "MP-LED-Y-3MM",
  "MP-CB-MODU-4VIAS",
  "MP-CB-ESP8266",
  "MP-BORN-M-2-381",
  "MP-BORN-F-2-381",
  "MP-ARD-UNO",
  "MP-ESP-8266",
  "KIT-MP-UNO-E",
];

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  console.log(
    apply
      ? "MODO APPLY — excluindo o que estiver livre\n"
      : "DRY-RUN — nada será apagado (passe --apply para executar)\n"
  );

  let ok = 0;
  let skip = 0;
  let missing = 0;

  for (const codigo of CODIGOS) {
    const p = await prisma.produto.findUnique({
      where: { codigo },
      select: { id: true, codigo: true, descricao: true, ativo: true },
    });
    if (!p) {
      console.log(`— ${codigo}: não encontrado`);
      missing += 1;
      continue;
    }

    const av = await avaliarExclusaoProduto(p.id);
    if (!av.podeExcluir) {
      const motivos = av.bloqueios
        .map((b) => `${b.motivo}×${b.quantidade}`)
        .join("; ");
      console.log(`✗ ${codigo} (${p.descricao}): BLOQUEADO — ${motivos}`);
      skip += 1;
      continue;
    }

    if (!apply) {
      console.log(`✓ ${codigo} (${p.descricao}): livre — seria excluído`);
      ok += 1;
      continue;
    }

    try {
      await excluirProdutoSeLivre(p.id);
      console.log(`✓ ${codigo}: excluído`);
      ok += 1;
    } catch (e) {
      console.log(
        `✗ ${codigo}: falha — ${e instanceof Error ? e.message : e}`
      );
      skip += 1;
    }
  }

  console.log(
    `\nResumo: livres/ok=${ok} bloqueados/falha=${skip} ausentes=${missing}`
  );
  if (!apply && ok > 0) {
    console.log("Para aplicar: pnpm exec tsx scripts/excluir-produtos-por-codigo.ts --apply");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
