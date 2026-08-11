import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anexarRmaSchema,
  createRmaProcessoSchema,
  semManutencaoRmaSchema,
  trocarRmaItemSchema,
} from "@teep/shared";
import {
  detectPdfMime,
  detectUploadMime,
  detectWordMime,
  isAllowedMime,
} from "../lib/uploads";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_ITEM = "33333333-3333-4333-8333-333333333333";
const UUID_ORIGEM = "44444444-4444-4444-8444-444444444444";
const UUID_DESC = "55555555-5555-4555-8555-555555555555";

describe("createRmaProcessoSchema", () => {
  it("exige series em cada item", () => {
    const r = createRmaProcessoSchema.safeParse({
      clienteId: UUID_A,
      itens: [{ produtoId: UUID_B, quantidade: 2 }],
    });
    assert.equal(r.success, false);
  });

  it("aceita nota com produto + série", () => {
    const r = createRmaProcessoSchema.safeParse({
      clienteId: UUID_A,
      itens: [{ produtoId: UUID_B, series: ["SN-001"] }],
    });
    assert.equal(r.success, true);
  });

  it("rejeita série duplicada na mesma nota", () => {
    const r = createRmaProcessoSchema.safeParse({
      clienteId: UUID_A,
      itens: [
        { produtoId: UUID_B, series: ["SN-001"] },
        { produtoId: UUID_B, series: ["sn-001"] },
      ],
    });
    assert.equal(r.success, false);
  });

  it("rejeita mais de 50 itens", () => {
    const itens = Array.from({ length: 51 }, (_, i) => ({
      produtoId: UUID_B,
      series: [`SN-${i}`],
    }));
    const r = createRmaProcessoSchema.safeParse({
      clienteId: UUID_A,
      itens,
    });
    assert.equal(r.success, false);
  });
});

describe("semManutencaoRmaSchema", () => {
  it("exige ao menos um itemId", () => {
    const r = semManutencaoRmaSchema.safeParse({ itemIds: [] });
    assert.equal(r.success, false);
  });

  it("aceita lista de itens", () => {
    const r = semManutencaoRmaSchema.safeParse({ itemIds: [UUID_ITEM] });
    assert.equal(r.success, true);
  });
});

describe("trocarRmaItemSchema", () => {
  it("exige origem, série boa e item", () => {
    const r = trocarRmaItemSchema.safeParse({
      itemId: UUID_ITEM,
    });
    assert.equal(r.success, false);
  });

  it("aceita payload mínimo válido", () => {
    const r = trocarRmaItemSchema.safeParse({
      itemId: UUID_ITEM,
      origemFilialId: UUID_ORIGEM,
      numeroSerieBoa: "SN-BOA-001",
      destinoDescarteFilialId: UUID_DESC,
    });
    assert.equal(r.success, true);
  });

  it("rejeita série boa vazia", () => {
    const r = trocarRmaItemSchema.safeParse({
      itemId: UUID_ITEM,
      origemFilialId: UUID_ORIGEM,
      numeroSerieBoa: "   ",
    });
    assert.equal(r.success, false);
  });
});

describe("anexarRmaSchema", () => {
  it("LAUDO exige itemId", () => {
    const r = anexarRmaSchema.safeParse({
      tipo: "LAUDO",
      arquivo: `/uploads/rma/_tmp/${UUID_A}-abcdef012345.pdf`,
    });
    assert.equal(r.success, false);
  });

  it("LAUDO com itemId passa", () => {
    const r = anexarRmaSchema.safeParse({
      tipo: "LAUDO",
      arquivo: `/uploads/rma/_tmp/${UUID_A}-abcdef012345.pdf`,
      itemId: UUID_ITEM,
    });
    assert.equal(r.success, true);
  });

  it("NF_ENTRADA não exige itemId", () => {
    const r = anexarRmaSchema.safeParse({
      tipo: "NF_ENTRADA",
      arquivo: `/uploads/rma/_tmp/${UUID_A}-abcdef012345.pdf`,
    });
    assert.equal(r.success, true);
  });

  it("trunca label longo em vez de rejeitar", () => {
    const long = `${"L".repeat(200)}.pdf`;
    const r = anexarRmaSchema.safeParse({
      tipo: "NF_ENTRADA",
      arquivo: `/uploads/rma/_tmp/${UUID_A}-abcdef012345.pdf`,
      label: long,
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.ok((r.data.label?.length || 0) <= 120);
      assert.ok(r.data.label?.endsWith(".pdf"));
    }
  });
});

describe("detectWordMime / upload mime opts", () => {
  it("rejeita OLE genérico sem WordDocument", () => {
    const ole = Buffer.alloc(64, 0);
    ole[0] = 0xd0;
    ole[1] = 0xcf;
    ole[2] = 0x11;
    ole[3] = 0xe0;
    assert.equal(detectWordMime(ole), null);
  });

  it("aceita OLE com marcador WordDocument", () => {
    const ole = Buffer.alloc(128, 0);
    ole[0] = 0xd0;
    ole[1] = 0xcf;
    ole[2] = 0x11;
    ole[3] = 0xe0;
    ole.write("WordDocument", 32, "ascii");
    assert.equal(detectWordMime(ole), "application/msword");
  });

  it("rejeita ZIP sem word/document.xml", () => {
    const zip = Buffer.from("PK\x03\x04hello word/foo bar", "binary");
    assert.equal(detectWordMime(zip), null);
  });

  it("aceita ZIP com word/document.xml", () => {
    const zip = Buffer.from(
      "PK\x03\x04[Content_Types].xml\0word/document.xml\0",
      "binary"
    );
    assert.equal(
      detectWordMime(zip),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("nota-fiscal não permite Word", () => {
    const ole = Buffer.alloc(128, 0);
    ole[0] = 0xd0;
    ole[1] = 0xcf;
    ole[2] = 0x11;
    ole[3] = 0xe0;
    ole.write("WordDocument", 32, "ascii");
    assert.equal(detectUploadMime(ole, { pdf: true, word: false }), null);
    assert.equal(
      isAllowedMime("application/msword", { pdf: true, word: false }),
      false
    );
  });

  it("documento permite Word e PDF", () => {
    assert.equal(
      isAllowedMime("application/msword", { pdf: true, word: true }),
      true
    );
    assert.equal(
      isAllowedMime("application/pdf", { pdf: true, word: true }),
      true
    );
    const pdf = Buffer.from("%PDF-1.4 rest", "ascii");
    assert.equal(detectPdfMime(pdf), "application/pdf");
    assert.equal(detectUploadMime(pdf, { pdf: true, word: false }), "application/pdf");
  });
});
