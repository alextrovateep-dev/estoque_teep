import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { aplicarSaldo } from "./estoqueService";

const prisma = new PrismaClient();

describe("estoque concurrency", () => {
  it("two concurrent SAIDA cannot overdraw", async () => {
    const filial = await prisma.filial.findFirstOrThrow({ where: { sigla: "PLN" } });
    const cat = await prisma.categoria.findFirstOrThrow();
    const codigo = `CONC-${Date.now()}`;
    const produto = await prisma.produto.create({
      data: {
        codigo,
        descricao: "Concurrency test",
        categoriaId: cat.id,
        precoUnitario: 1,
        estoqueMinimo: 0,
      },
    });

    await prisma.$transaction(async (tx) => {
      await aplicarSaldo(tx, {
        produtoId: produto.id,
        filialId: filial.id,
        operacao: "ENTRADA",
        quantidade: 5,
      });
    });

    const results = await Promise.allSettled([
      prisma.$transaction((tx) =>
        aplicarSaldo(tx, {
          produtoId: produto.id,
          filialId: filial.id,
          operacao: "SAIDA",
          quantidade: 4,
        })
      ),
      prisma.$transaction((tx) =>
        aplicarSaldo(tx, {
          produtoId: produto.id,
          filialId: filial.id,
          operacao: "SAIDA",
          quantidade: 4,
        })
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    assert.equal(fulfilled, 1);
    assert.equal(rejected, 1);

    const estoque = await prisma.estoque.findUniqueOrThrow({
      where: {
        uniq_produto_filial: { produtoId: produto.id, filialId: filial.id },
      },
    });
    assert.equal(Number(estoque.saldoAtual), 1);

    await prisma.produto.delete({ where: { id: produto.id } });
  });
});
