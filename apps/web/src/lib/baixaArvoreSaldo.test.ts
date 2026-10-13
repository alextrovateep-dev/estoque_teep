import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consumoArvoreComFalta,
  consumoBaixaArvoreOrigem,
} from "./baixaArvoreSaldo";

const bom = [
  {
    produtoFilhoId: "placa",
    quantidade: 2,
    fantasma: false,
    produtoFilho: { codigo: "PLC", unidade: "UN" },
  },
  {
    produtoFilhoId: "kit",
    quantidade: 1,
    fantasma: true,
    produtoFilho: { codigo: "KIT" },
  },
];

describe("consumoBaixaArvoreOrigem", () => {
  it("ignora fantasma e multiplica pelo pai", () => {
    const linhas = consumoBaixaArvoreOrigem(bom, 3);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]!.produtoFilhoId, "placa");
    assert.equal(linhas[0]!.quantidade, 6);
  });

  it("quantidade inválida do pai zera o consumo", () => {
    assert.deepEqual(consumoBaixaArvoreOrigem(bom, 0), [
      {
        produtoFilhoId: "placa",
        codigo: "PLC",
        unidade: "UN",
        quantidade: 0,
      },
    ]);
  });
});

describe("consumoArvoreComFalta", () => {
  it("não usa saldo do pai — só componente com saldo conhecido e insuficiente", () => {
    const consumo = consumoBaixaArvoreOrigem(bom, 2);
    const falta = consumoArvoreComFalta(consumo, {
      placa: 3,
    });
    assert.equal(falta.length, 1);
    assert.equal(falta[0]!.codigo, "PLC");
  });

  it("sem saldo carregado não marca falta (espera a consulta)", () => {
    const consumo = consumoBaixaArvoreOrigem(bom, 2);
    assert.equal(consumoArvoreComFalta(consumo, {}).length, 0);
  });
});
