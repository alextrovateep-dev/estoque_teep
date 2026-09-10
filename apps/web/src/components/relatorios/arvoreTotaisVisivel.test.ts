import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  totaisArvoreVisivel,
  type ArvoreComponenteRelatorio,
} from "./arvoreTotaisVisivel";

function c(
  partial: Partial<ArvoreComponenteRelatorio> &
    Pick<ArvoreComponenteRelatorio, "codigo" | "quantidade">
): ArvoreComponenteRelatorio {
  return {
    descricao: partial.codigo,
    fantasma: false,
    precoUnitario: 0,
    valorLinha: 0,
    ...partial,
  };
}

describe("totaisArvoreVisivel", () => {
  it("sem expansão conta só o 1º nível", () => {
    const comps = [
      c({
        codigo: "KIT",
        produtoFilhoId: "k1",
        quantidade: 1,
        temBom: true,
      }),
      c({ codigo: "CX", produtoFilhoId: "c1", quantidade: 1 }),
    ];
    const t = totaisArvoreVisivel(comps, new Set(), {});
    assert.equal(t.itens, 2);
    assert.equal(t.quantidade, 2);
  });

  it("com kit aberto troca a linha do kit pelos filhos", () => {
    const comps = [
      c({
        codigo: "KIT",
        produtoFilhoId: "k1",
        quantidade: 1,
        temBom: true,
      }),
      c({ codigo: "CX", produtoFilhoId: "c1", quantidade: 1 }),
    ];
    const filhos = {
      k1: [
        c({ codigo: "A", produtoFilhoId: "a", quantidade: 1 }),
        c({ codigo: "B", produtoFilhoId: "b", quantidade: 3 }),
        c({ codigo: "C", produtoFilhoId: "c", quantidade: 1 }),
      ],
    };
    const t = totaisArvoreVisivel(comps, new Set(["k1"]), filhos);
    assert.equal(t.itens, 4);
    assert.equal(t.quantidade, 1 + 3 + 1 + 1);
  });

  it("multiplica qtd dos filhos pelo fator do kit", () => {
    const comps = [
      c({
        codigo: "KIT",
        produtoFilhoId: "k1",
        quantidade: 2,
        temBom: true,
      }),
    ];
    const filhos = {
      k1: [c({ codigo: "PARAF", produtoFilhoId: "p", quantidade: 3 })],
    };
    const t = totaisArvoreVisivel(comps, new Set(["k1"]), filhos);
    assert.equal(t.itens, 1);
    assert.equal(t.quantidade, 6);
  });
});
