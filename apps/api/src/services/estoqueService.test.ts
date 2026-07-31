import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

describe("estoque decimal math", () => {
  it("subtracts without going negative when equal", () => {
    const saldo = new Prisma.Decimal(10);
    const qtd = new Prisma.Decimal(10);
    assert.equal(saldo.lt(qtd), false);
    assert.equal(Number(saldo.sub(qtd)), 0);
  });

  it("detects insufficient stock", () => {
    const saldo = new Prisma.Decimal(5);
    const qtd = new Prisma.Decimal(6);
    assert.equal(saldo.lt(qtd), true);
  });
});
