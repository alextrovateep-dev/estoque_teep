import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertExtForRmaTipo,
  isValidRmaAtualPath,
  isValidRmaTmpPath,
} from "./rmaUploads";

const USER = "11111111-1111-4111-8111-111111111111";
const PROC = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

describe("rmaUploads paths / extensões", () => {
  it("aceita tmp do próprio usuário", () => {
    assert.equal(
      isValidRmaTmpPath(`/uploads/rma/_tmp/${USER}-abcdef012345.pdf`, USER),
      true
    );
  });

  it("rejeita tmp de outro usuário", () => {
    assert.equal(
      isValidRmaTmpPath(
        `/uploads/rma/_tmp/${PROC}-abcdef012345.pdf`,
        USER
      ),
      false
    );
  });

  it("valida paths canônicos de atual/", () => {
    assert.equal(
      isValidRmaAtualPath(
        `/uploads/rma/${PROC}/atual/nf-entrada.pdf`,
        PROC
      ),
      true
    );
    assert.equal(
      isValidRmaAtualPath(
        `/uploads/rma/${PROC}/atual/laudos/${ITEM}.docx`,
        PROC
      ),
      true
    );
    assert.equal(
      isValidRmaAtualPath(
        `/uploads/rma/${PROC}/atual/nf-entrada.docx`,
        PROC
      ),
      false
    );
  });

  it("NF rejeita Word; laudo aceita", () => {
    assert.throws(() => assertExtForRmaTipo("NF_ENTRADA", "docx"));
    assert.doesNotThrow(() => assertExtForRmaTipo("LAUDO", "docx"));
    assert.doesNotThrow(() => assertExtForRmaTipo("NF_SAIDA", "pdf"));
  });
});
