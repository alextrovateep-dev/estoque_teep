import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bodyTextToHtml,
  parseEmailCtaLine,
} from "./transactionalLayout";

describe("parseEmailCtaLine", () => {
  it("extrai rótulo e URL", () => {
    const r = parseEmailCtaLine(
      "Cadastro do produto: https://estoque.teep.com.br/cadastros/produtos/abc"
    );
    assert.ok(r);
    assert.equal(r!.label, "Cadastro do produto");
    assert.equal(
      r!.href,
      "https://estoque.teep.com.br/cadastros/produtos/abc"
    );
  });

  it("ignora texto sem URL", () => {
    assert.equal(parseEmailCtaLine("Preço alterado para R$ 10"), null);
  });
});

describe("bodyTextToHtml", () => {
  it("converte linha CTA em botão sem exibir a URL", () => {
    const html = bodyTextToHtml(
      [
        "O preço foi alterado.",
        "",
        "Cadastro do produto: https://estoque.teep.com.br/cadastros/produtos/x",
      ].join("\n")
    );
    assert.match(html, /Cadastro do produto/);
    assert.match(
      html,
      /href="https:\/\/estoque\.teep\.com\.br\/cadastros\/produtos\/x"/
    );
    assert.doesNotMatch(html, />https:\/\/estoque/);
    assert.match(html, /background:#5B8B83/);
  });

  it("escapa HTML no texto", () => {
    const html = bodyTextToHtml('Item <script> com "aspas"');
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&quot;aspas&quot;/);
  });
});
