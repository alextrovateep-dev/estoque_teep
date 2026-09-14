import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffBomTransformacao } from "./transformacaoService";
import type { BomLinha } from "./montagemService";

function linha(
  id: string,
  codigo: string,
  quantidade: number,
  opts?: { fantasma?: boolean }
): BomLinha {
  return {
    produtoFilhoId: id,
    quantidade,
    fantasma: opts?.fantasma ?? false,
    filho: {
      id,
      codigo,
      descricao: codigo,
      controlaSerie: false,
      precoUnitario: 0,
      ativo: true,
    },
  };
}

describe("diffBomTransformacao", () => {
  const origemId = "prod-w";

  it("baixa só o delta (kit compartilhado coberto + MP novo)", () => {
    const bomA = [linha("kit", "KIT-MP-ESP32-W", 1)];
    const bomB = [
      linha("kit", "KIT-MP-ESP32-W", 1),
      linha("rede", "MP-REDE-W5500", 1),
    ];
    const { detalhe, bomDelta } = diffBomTransformacao(bomA, bomB, origemId);

    assert.equal(bomDelta.length, 1);
    assert.equal(bomDelta[0]!.filho.codigo, "MP-REDE-W5500");
    assert.equal(bomDelta[0]!.quantidade, 1);

    const kit = detalhe.find((d) => d.codigo === "KIT-MP-ESP32-W");
    assert.ok(kit);
    assert.equal(kit!.motivo, "COBERTO_ORIGEM");
    assert.equal(kit!.qtdBaixar, 0);

    const rede = detalhe.find((d) => d.codigo === "MP-REDE-W5500");
    assert.ok(rede);
    assert.equal(rede!.motivo, "BAIXAR");
    assert.equal(rede!.qtdBaixar, 1);
  });

  it("BOM idêntica → nada a baixar", () => {
    const bom = [
      linha("kit", "KIT-MP-ESP32-W", 1),
      linha("rede", "MP-REDE-W5500", 1),
    ];
    const { bomDelta, detalhe } = diffBomTransformacao(bom, bom, origemId);
    assert.equal(bomDelta.length, 0);
    assert.ok(detalhe.every((d) => d.motivo === "COBERTO_ORIGEM"));
  });

  it("qty destino maior que origem → baixa a diferença", () => {
    const bomA = [linha("kit", "KIT-X", 1)];
    const bomB = [linha("kit", "KIT-X", 3)];
    const { bomDelta } = diffBomTransformacao(bomA, bomB, origemId);
    assert.equal(bomDelta.length, 1);
    assert.equal(bomDelta[0]!.quantidade, 2);
  });

  it("exclui o próprio acabado A se estiver na BOM de B", () => {
    const bomA = [linha("kit", "KIT-X", 1)];
    const bomB = [
      linha(origemId, "TMP-1144-W", 1),
      linha("rede", "MP-REDE-W5500", 1),
    ];
    const { detalhe, bomDelta } = diffBomTransformacao(bomA, bomB, origemId);
    const acabado = detalhe.find((d) => d.produtoFilhoId === origemId);
    assert.ok(acabado);
    assert.equal(acabado!.motivo, "EXCLUIDO_ORIGEM_ACABADO");
    assert.equal(acabado!.qtdOrigem, 0);
    assert.equal(bomDelta.length, 1);
    assert.equal(bomDelta[0]!.filho.codigo, "MP-REDE-W5500");
  });

  it("fantasma na origem não cobre componente real do destino", () => {
    const bomA = [linha("kit", "KIT-X", 1, { fantasma: true })];
    const bomB = [linha("kit", "KIT-X", 1)];
    const { bomDelta } = diffBomTransformacao(bomA, bomB, origemId);
    assert.equal(bomDelta.length, 1);
    assert.equal(bomDelta[0]!.quantidade, 1);
  });

  it("sem origem → baixa a árvore inteira de B", () => {
    const bomB = [
      linha("kit", "KIT-X", 1),
      linha("rede", "MP-Y", 1),
    ];
    const { bomDelta } = diffBomTransformacao([], bomB, "");
    assert.equal(bomDelta.length, 2);
  });
});
