import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSISTENTE_CHAT_MAX_CHARS,
  assistenteChatSchema,
  paginarTextoAssistente,
} from "@teep/shared";

describe("assistenteChatSchema", () => {
  it("trunca histórico longo em vez de rejeitar (máx. 2000)", () => {
    const longo = "A".repeat(ASSISTENTE_CHAT_MAX_CHARS + 400);
    const parsed = assistenteChatSchema.safeParse({
      message: "e as transferências?",
      history: [{ role: "assistant", content: longo }],
    });
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.history[0]?.content.length, ASSISTENTE_CHAT_MAX_CHARS);
  });

  it("trunca mensagem longa em vez de 400", () => {
    const parsed = assistenteChatSchema.safeParse({
      message: "B".repeat(ASSISTENTE_CHAT_MAX_CHARS + 50),
    });
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.message.length, ASSISTENTE_CHAT_MAX_CHARS);
  });

  it("paginarTextoAssistente cabe no limite e não quebra", () => {
    const bruto = Array.from({ length: 80 }, (_, i) => `• carga ${i} PLN → TBO — Recebido SKU${i}`).join("\n");
    const out = paginarTextoAssistente(bruto);
    assert.ok(out.length <= ASSISTENTE_CHAT_MAX_CHARS);
    assert.match(out, /cortada no limite/);
  });
});
