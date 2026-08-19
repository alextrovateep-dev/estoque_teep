import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rmaItemEntraNoPdfOrcamento } from "@teep/shared";
import {
  formatarRespostaChecklistCampo,
  htmlLaudoRecebimento,
  mapPerguntasLaudo,
} from "./rmaOrcamentoPdfHtml";

describe("rmaItemEntraNoPdfOrcamento", () => {
  it("inclui rascunho e negociação", () => {
    assert.equal(
      rmaItemEntraNoPdfOrcamento({
        etapa: "AGUARDANDO_ORCAMENTO",
        orcamentoStatus: "RASCUNHO",
      }),
      true
    );
    assert.equal(
      rmaItemEntraNoPdfOrcamento({
        etapa: "AGUARDANDO_APROVACAO",
        orcamentoStatus: "ENVIADO",
      }),
      true
    );
  });

  it("exclui aprovado, recusado e etapas posteriores", () => {
    assert.equal(
      rmaItemEntraNoPdfOrcamento({
        etapa: "AGUARDANDO_MANUTENCAO",
        orcamentoStatus: "APROVADO",
      }),
      false
    );
    assert.equal(
      rmaItemEntraNoPdfOrcamento({
        etapa: "NAO_APROVADO",
        orcamentoStatus: "RECUSADO",
      }),
      false
    );
    assert.equal(
      rmaItemEntraNoPdfOrcamento({
        etapa: "AGUARDANDO_ENVIO",
        orcamentoStatus: "ENVIADO",
      }),
      false
    );
  });
});

describe("html laudo de recebimento no PDF", () => {
  it("formata Sim/Não e texto", () => {
    assert.equal(
      formatarRespostaChecklistCampo({
        tipoCampo: "SIM_NAO",
        valorBool: true,
      }),
      "Sim"
    );
    assert.equal(
      formatarRespostaChecklistCampo({
        tipoCampo: "SIM_NAO",
        valorBool: false,
      }),
      "Não"
    );
    assert.equal(
      formatarRespostaChecklistCampo({
        tipoCampo: "TEXTO",
        valorTexto: "Carcaça amassada",
      }),
      "Carcaça amassada"
    );
  });

  it("mapeia perguntas do checklist e inclui fotos no HTML", () => {
    const qid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const perguntas = mapPerguntasLaudo({
      template: {
        itens: [
          {
            id: qid,
            codigo: "01",
            titulo: "Equipamento liga?",
            tipoCampo: "SIM_NAO",
            ordem: 1,
          },
        ],
      },
      respostas: [
        {
          templateItemId: qid,
          valorBool: false,
          fotos: ["/uploads/rma/x.jpg"],
        },
      ],
    });
    assert.equal(perguntas[0]?.fotos[0], "/uploads/rma/x.jpg");
    const html = htmlLaudoRecebimento(
      [
        {
          codigoProduto: "TMP-1122-W",
          descricao: "Temporizador",
          numeroSerie: "TMP1122W260007",
          diagnostico: {
            resumoProblema: "Não liga",
            observacaoTecnica: "Cabo oxidado",
          },
          preenchidoPorNome: "Técnico",
          perguntas,
        },
      ],
      (url) =>
        url.endsWith(".jpg") ? "data:image/jpeg;base64,QQ==" : null
    );
    assert.match(html, /Laudo de recebimento/);
    assert.match(html, /Equipamento liga\?/);
    assert.match(html, />Não</);
    assert.match(html, /Cabo oxidado/);
    assert.match(html, /foto-frame/);
    assert.match(html, /data:image\/jpeg;base64,QQ==/);
  });
});
