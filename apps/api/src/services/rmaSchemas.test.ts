import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anexarRmaSchema,
  createRmaProcessoSchema,
  mensagemBloqueioDiagnostico,
  mensagemBloqueioNfRetorno,
  mensagemBloqueioReabrirOrcamento,
  checklistFotoExigida,
  checklistMostrarCampoFoto,
  emailsAlertaDeUsuariosRma,
  parseYmd,
  mensagemErroValidacao,
  RMA_ORCAMENTO_STATUS_LABELS,
  rmaOrcamentoPodeEditar,
  salvarRmaDiagnosticoPlanoSchema,
  semManutencaoRmaSchema,
  trocarRmaItemSchema,
  updateRmaItemFinanceiroSchema,
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

  it("aceita nota com produto + série e NF de entrada", () => {
    const r = createRmaProcessoSchema.safeParse({
      clienteId: UUID_A,
      responsavelComercialId: UUID_A,
      nfEntradaNumero: "4040",
      itens: [{ produtoId: UUID_B, series: ["SN-001"] }],
    });
    assert.equal(r.success, true);
  });

  it("aceita prazo de manutenção válido", () => {
    const r = createRmaProcessoSchema.safeParse({
      clienteId: UUID_A,
      responsavelComercialId: UUID_A,
      nfEntradaNumero: "4040",
      prazoManutencao: "2026-08-25",
      itens: [{ produtoId: UUID_B, series: ["SN-001"] }],
    });
    assert.equal(r.success, true);
  });

  it("rejeita prazo de manutenção inválido", () => {
    const r = createRmaProcessoSchema.safeParse({
      clienteId: UUID_A,
      responsavelComercialId: UUID_A,
      nfEntradaNumero: "4040",
      prazoManutencao: "2026-02-31",
      itens: [{ produtoId: UUID_B, series: ["SN-001"] }],
    });
    assert.equal(r.success, false);
  });

  it("parseYmd rejeita 31/02 e aceita data civil", () => {
    assert.equal(parseYmd("2026-02-31"), null);
    assert.equal(parseYmd("2026-08-25"), "2026-08-25");
    assert.equal(parseYmd(""), null);
  });

  it("rejeita sem NF de entrada", () => {
    const r = createRmaProcessoSchema.safeParse({
      clienteId: UUID_A,
      responsavelComercialId: UUID_A,
      itens: [{ produtoId: UUID_B, series: ["SN-001"] }],
    });
    assert.equal(r.success, false);
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

describe("updateRmaItemFinanceiroSchema", () => {
  it("exige valor e NF quando cobrou=true", () => {
    const r = updateRmaItemFinanceiroSchema.safeParse({ cobrou: true });
    assert.equal(r.success, false);
  });

  it("aceita cobrou false", () => {
    const r = updateRmaItemFinanceiroSchema.safeParse({ cobrou: false });
    assert.equal(r.success, true);
  });

  it("aceita cobrou true com valor e NF", () => {
    const r = updateRmaItemFinanceiroSchema.safeParse({
      cobrou: true,
      valorCobrado: 150,
      nfCobrancaNumero: "NF-1",
    });
    assert.equal(r.success, true);
  });
});

describe("anexarRmaSchema", () => {
  it("LAUDO ainda valida no schema (API rejeita novos uploads)", () => {
    const r = anexarRmaSchema.safeParse({
      tipo: "LAUDO",
      arquivo: `/uploads/rma/_tmp/${UUID_A}-abcdef012345.pdf`,
      itemId: UUID_ITEM,
    });
    assert.equal(r.success, true);
  });

  it("LAUDO sem itemId falha no schema", () => {
    const r = anexarRmaSchema.safeParse({
      tipo: "LAUDO",
      arquivo: `/uploads/rma/_tmp/${UUID_A}-abcdef012345.pdf`,
    });
    assert.equal(r.success, false);
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

describe("salvarRmaDiagnosticoPlanoSchema", () => {
  it("aceita plano com serviço, tempo e peça", () => {
    const r = salvarRmaDiagnosticoPlanoSchema.safeParse({
      resumoProblema: "Pulso fantasma — troca da placa de controle",
      observacaoTecnica: "O aparelho não ligou na bancada.",
      servicos: [
        { descricao: "Troca da placa de controle", ordem: 0, tempoMinutos: 10 },
      ],
      pecas: [{ produtoId: UUID_B, quantidade: 1, motivo: null }],
    });
    assert.equal(r.success, true);
  });

  it("aceita quantidade e tempo como string", () => {
    const r = salvarRmaDiagnosticoPlanoSchema.safeParse({
      resumoProblema: "Defeito",
      servicos: [{ descricao: "Revisão", tempoMinutos: "10" }],
      pecas: [{ produtoId: UUID_B, quantidade: "1" }],
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.servicos[0]?.tempoMinutos, 10);
      assert.equal(r.data.pecas[0]?.quantidade, 1);
    }
  });

  it("rejeita resumo vazio", () => {
    const r = salvarRmaDiagnosticoPlanoSchema.safeParse({
      resumoProblema: "  ",
      servicos: [{ descricao: "Revisão" }],
    });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.match(r.error.issues[0]?.message || "", /resumo/i);
    }
  });

  it("pede para selecionar a peça se o id for inválido", () => {
    const r = salvarRmaDiagnosticoPlanoSchema.safeParse({
      resumoProblema: "Defeito",
      pecas: [{ produtoId: "nao-e-uuid", quantidade: 1 }],
    });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.match(r.error.issues[0]?.message || "", /peça|produto/i);
    }
  });
});

describe("mensagemBloqueioNfRetorno", () => {
  it("bloqueia sem número", () => {
    const msg = mensagemBloqueioNfRetorno({
      nfSaidaNumero: "  ",
      temArquivoNfSaida: true,
    });
    assert.match(String(msg), /NF de retorno/i);
  });

  it("bloqueia sem arquivo", () => {
    const msg = mensagemBloqueioNfRetorno({
      nfSaidaNumero: "4040",
      temArquivoNfSaida: false,
    });
    assert.match(String(msg), /arquivo/i);
  });

  it("libera com número e arquivo", () => {
    assert.equal(
      mensagemBloqueioNfRetorno({
        nfSaidaNumero: "4040",
        temArquivoNfSaida: true,
      }),
      null
    );
  });
});

describe("emailsAlertaDeUsuariosRma", () => {
  it("usa e-mail dos destinatários do RMA", () => {
    assert.deepEqual(
      emailsAlertaDeUsuariosRma([
        { email: "admin@teep.com.br", ativo: true },
        { email: "  Admin@teep.com.br ", ativo: true },
      ]),
      ["admin@teep.com.br"]
    );
  });

  it("ignora inativo e sem e-mail", () => {
    assert.deepEqual(
      emailsAlertaDeUsuariosRma([
        { email: "off@teep.com.br", ativo: false },
        { email: "  ", ativo: true },
        null,
        { email: "ok@teep.com.br" },
      ]),
      ["ok@teep.com.br"]
    );
  });
});

describe("checklistFotoExigida", () => {
  it("Não não exige foto quando o gatilho é SIM", () => {
    assert.equal(
      checklistFotoExigida({
        tipoCampo: "SIM_NAO",
        exigeFotoSe: "SIM",
        valorBool: false,
      }),
      false
    );
  });

  it("Sim exige foto quando o gatilho é SIM", () => {
    assert.equal(
      checklistFotoExigida({
        tipoCampo: "SIM_NAO",
        exigeFotoSe: "SIM",
        valorBool: true,
      }),
      true
    );
  });

  it("normaliza Não acentuado no gatilho de outras perguntas", () => {
    assert.equal(
      checklistFotoExigida({
        tipoCampo: "SIM_NAO",
        exigeFotoSe: "Não",
        valorBool: false,
      }),
      true
    );
    assert.equal(
      checklistFotoExigida({
        tipoCampo: "SIM_NAO",
        exigeFotoSe: "Não",
        valorBool: true,
      }),
      false
    );
  });

  it("pergunta Só foto obrigatória continua exigindo anexo", () => {
    assert.equal(
      checklistFotoExigida({
        tipoCampo: "FOTO",
        obrigatorio: true,
        exigeFotoSe: "SIM",
        valorBool: false,
      }),
      true
    );
    assert.equal(
      checklistFotoExigida({
        tipoCampo: "FOTO",
        obrigatorio: false,
      }),
      false
    );
  });

  it("esconde o campo de foto quando Não e o gatilho é SIM", () => {
    assert.equal(
      checklistMostrarCampoFoto({
        tipoCampo: "SIM_NAO",
        exigeFotoSe: "SIM",
        valorBool: false,
      }),
      false
    );
  });
});

describe("mensagemBloqueioDiagnostico", () => {
  it("libera sem template nem execução", () => {
    assert.equal(
      mensagemBloqueioDiagnostico({ temTemplateRecebimento: false }),
      null
    );
  });

  it("bloqueia template sem execução", () => {
    assert.ok(
      mensagemBloqueioDiagnostico({ temTemplateRecebimento: true })
    );
  });

  it("bloqueia enquanto o template é desconhecido", () => {
    assert.ok(
      mensagemBloqueioDiagnostico({ temTemplateRecebimento: null })
    );
  });

  it("libera checklist concluído", () => {
    assert.equal(
      mensagemBloqueioDiagnostico({
        temTemplateRecebimento: true,
        execucaoRecebimento: { status: "CONCLUIDO" },
      }),
      null
    );
  });
});

describe("reabrir orçamento", () => {
  it("rótulo ENVIADO é Em negociação", () => {
    assert.equal(RMA_ORCAMENTO_STATUS_LABELS.ENVIADO, "Em negociação");
  });

  it("permite editar valores em negociação", () => {
    assert.equal(
      rmaOrcamentoPodeEditar({
        etapa: "AGUARDANDO_APROVACAO",
        orcamentoStatus: "ENVIADO",
      }),
      true
    );
    assert.equal(
      rmaOrcamentoPodeEditar({
        etapa: "AGUARDANDO_ORCAMENTO",
        orcamentoStatus: "ENVIADO",
      }),
      false
    );
    assert.equal(
      rmaOrcamentoPodeEditar({
        etapa: "AGUARDANDO_MANUTENCAO",
        orcamentoStatus: "APROVADO",
      }),
      false
    );
  });

  it("permite reabrir fechado aguardando aprovação (volta a rascunho)", () => {
    assert.equal(
      mensagemBloqueioReabrirOrcamento({
        orcamentoStatus: "ENVIADO",
        etapa: "AGUARDANDO_APROVACAO",
      }),
      null
    );
  });

  it("bloqueia se já aprovado", () => {
    const msg = mensagemBloqueioReabrirOrcamento({
      orcamentoStatus: "APROVADO",
      etapa: "AGUARDANDO_MANUTENCAO",
    });
    assert.match(String(msg), /aprovado/i);
  });

  it("bloqueia se recusado ou ainda em rascunho", () => {
    assert.match(
      String(
        mensagemBloqueioReabrirOrcamento({
          orcamentoStatus: "RECUSADO",
          etapa: "NAO_APROVADO",
        })
      ),
      /recusado/i
    );
    assert.ok(
      mensagemBloqueioReabrirOrcamento({
        orcamentoStatus: "RASCUNHO",
        etapa: "AGUARDANDO_ORCAMENTO",
      })
    );
  });
});

describe("mensagemErroValidacao", () => {
  it("preserva mensagem específica (série, checklist, etc.)", () => {
    assert.equal(
      mensagemErroValidacao({ message: "Informe o número de série" }),
      "Informe o número de série"
    );
  });

  it("não chuta série quando o campo é peça", () => {
    const msg = mensagemErroValidacao({
      message: "Invalid uuid",
      path: ["pecas", 0, "produtoId"],
    });
    assert.match(msg, /produto|peça/i);
    assert.equal(/série|serie/i.test(msg), false);
  });

  it("usa fallback genérico sem citar série", () => {
    const msg = mensagemErroValidacao({ message: "Dados inválidos" });
    assert.equal(/série|serie|cliente/i.test(msg), false);
  });
});
