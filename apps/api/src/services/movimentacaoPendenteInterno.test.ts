import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deveFicarPendenteAprovacao,
  reativarSaidoNoLancamento,
  tipoUsaBaixaArvore,
} from "./movimentacaoService";
import {
  serieEntradaAceitaExistente,
  serieLivreDeRmaAtivo,
} from "./serieService";

describe("deveFicarPendenteAprovacao", () => {
  it("operador + tipo com aprovação → pendente no lançamento manual", () => {
    assert.equal(
      deveFicarPendenteAprovacao({
        perfil: "OPERADOR",
        requerAprovacao: true,
      }),
      true
    );
  });

  it("usoInternoRma nunca fica pendente", () => {
    assert.equal(
      deveFicarPendenteAprovacao({
        perfil: "OPERADOR",
        requerAprovacao: true,
        usoInternoRma: true,
      }),
      false
    );
  });

  it("usoInternoPedido nunca fica pendente", () => {
    assert.equal(
      deveFicarPendenteAprovacao({
        perfil: "OPERADOR",
        requerAprovacao: true,
        usoInternoPedido: true,
      }),
      false
    );
  });

  it("gerente ignora requerAprovacao", () => {
    assert.equal(
      deveFicarPendenteAprovacao({
        perfil: "GERENTE",
        requerAprovacao: true,
      }),
      false
    );
  });
});

describe("tipoUsaBaixaArvore", () => {
  it("pedido eGestor não explode árvore mesmo se o tipo tiver a flag", () => {
    assert.equal(
      tipoUsaBaixaArvore({
        baixaPorArvore: true,
        saidaPedidoVenda: true,
        usoInternoPedido: true,
      }),
      false
    );
    assert.equal(
      tipoUsaBaixaArvore({
        baixaPorArvore: true,
        saidaPedidoVenda: false,
      }),
      true
    );
    assert.equal(
      tipoUsaBaixaArvore({
        baixaPorArvore: false,
        saidaPedidoVenda: false,
      }),
      false
    );
  });
});

describe("reativarSaidoNoLancamento", () => {
  it("retorno demo reativa SAIDO mesmo com produto que controla série", () => {
    assert.equal(
      reativarSaidoNoLancamento({ serieLivre: false, ehRetorno: true }),
      true
    );
  });

  it("entrada nova de produto com série não reativa", () => {
    assert.equal(
      reativarSaidoNoLancamento({ serieLivre: false, ehRetorno: false }),
      false
    );
  });
});

describe("serieEntradaAceitaExistente", () => {
  it("só aceita unidade SAIDO quando reativação está ligada", () => {
    assert.equal(
      serieEntradaAceitaExistente({
        permitirReativarSaido: true,
        status: "SAIDO",
      }),
      true
    );
    assert.equal(
      serieEntradaAceitaExistente({
        permitirReativarSaido: true,
        status: "EM_ESTOQUE",
      }),
      false
    );
    assert.equal(
      serieEntradaAceitaExistente({
        permitirReativarSaido: false,
        status: "SAIDO",
      }),
      false
    );
  });

  it("aceita SAIDO de RMA cancelado mesmo sem flag de retorno", () => {
    assert.equal(
      serieEntradaAceitaExistente({
        permitirReativarSaido: false,
        status: "SAIDO",
        somenteRmaCancelado: true,
      }),
      true
    );
    assert.equal(
      serieEntradaAceitaExistente({
        permitirReativarSaido: false,
        status: "EM_ESTOQUE",
        somenteRmaCancelado: true,
      }),
      false
    );
  });
});

describe("serieLivreDeRmaAtivo", () => {
  it("libera série só quando todos os vínculos RMA estão cancelados", () => {
    assert.equal(serieLivreDeRmaAtivo([]), false);
    assert.equal(
      serieLivreDeRmaAtivo([
        { status: "CANCELADO", processoStatus: "CANCELADO" },
      ]),
      true
    );
    assert.equal(
      serieLivreDeRmaAtivo([
        { status: "EM_ESTOQUE", processoStatus: "CANCELADO" },
      ]),
      true
    );
    assert.equal(
      serieLivreDeRmaAtivo([
        { status: "CANCELADO", processoStatus: "ABERTO" },
      ]),
      false
    );
    assert.equal(
      serieLivreDeRmaAtivo([
        { status: "EM_ESTOQUE", processoStatus: "ABERTO" },
      ]),
      false
    );
    assert.equal(
      serieLivreDeRmaAtivo([
        { status: "DEVOLVIDO", processoStatus: "FECHADO" },
      ]),
      false
    );
    assert.equal(
      serieLivreDeRmaAtivo([
        { status: "CANCELADO", processoStatus: "CANCELADO" },
        { status: "EM_ESTOQUE", processoStatus: "ABERTO" },
      ]),
      false
    );
  });
});
