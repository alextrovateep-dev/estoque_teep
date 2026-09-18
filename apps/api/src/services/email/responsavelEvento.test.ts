import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linhaResponsavel } from "@teep/shared";
import { ALERTA_EMAIL_TYPES, EMAIL_TYPES } from "./emailTypes";
import {
  defaultEmailTemplate,
  renderEmailFromTemplate,
  sampleVarsFor,
} from "./emailTemplateStore";

describe("linhaResponsavel", () => {
  it("monta a linha com o nome do usuário", () => {
    assert.equal(
      linhaResponsavel("  Carlos Admin "),
      "Usuário responsável por esse evento: Carlos Admin"
    );
  });

  it("some quando não há usuário (rotina automática)", () => {
    assert.equal(linhaResponsavel(undefined), null);
    assert.equal(linhaResponsavel("   "), null);
  });
});

describe("responsável no corpo do e-mail", () => {
  for (const type of EMAIL_TYPES) {
    it(`${type}: sample mostra o responsável no texto e no HTML`, () => {
      const vars = sampleVarsFor(type);
      const { text, html } = renderEmailFromTemplate(
        defaultEmailTemplate(type),
        vars
      );
      const esperado = "Usuário responsável por esse evento:";
      assert.ok(
        text.includes(esperado),
        `texto de ${type} sem a linha de responsável`
      );
      assert.ok(
        html.includes(esperado),
        `HTML de ${type} sem a linha de responsável`
      );
    });
  }

  it("alerta sem responsável não deixa bloco em branco", () => {
    const type = ALERTA_EMAIL_TYPES[0]!;
    const { text, html } = renderEmailFromTemplate(defaultEmailTemplate(type), {
      ...sampleVarsFor(type),
      mensagem: "Saldo atual: 2",
    });
    assert.ok(!text.includes("Usuário responsável"));
    assert.ok(!/\n{3,}/.test(text));
    assert.ok(!/<p[^>]*><\/p>/.test(html));
  });

  it("conta sem responsável não deixa bloco em branco", () => {
    const { text } = renderEmailFromTemplate(
      defaultEmailTemplate("ACESSO_SENHA_PROVISORIA"),
      { ...sampleVarsFor("ACESSO_SENHA_PROVISORIA"), responsavel: "" }
    );
    assert.ok(!text.includes("Usuário responsável"));
    assert.ok(!/\n{3,}/.test(text));
  });
});
