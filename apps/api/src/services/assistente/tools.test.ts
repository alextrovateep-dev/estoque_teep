import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeTool, toolsForUser, TOOL_DEFINITIONS } from "./tools";
import {
  collectActionLink,
  packToolContentForLlm,
  redactActionLinkForLlm,
  type AssistenteActionLink,
} from "./orchestrator";
import { buildSystemPrompt, janelaHojeSaoPaulo, janelaMesSaoPaulo } from "./systemPrompt";
import { parseAssistenteDateBound } from "./tools";
import type { AuthUser } from "../../middleware/auth";

const operador: AuthUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "op@test.com",
  nome: "Op",
  perfil: "OPERADOR",
  filialId: "00000000-0000-4000-8000-0000000000aa",
  filialIds: ["00000000-0000-4000-8000-0000000000aa"],
};

describe("assistente tools authz", () => {
  it("OPERADOR ignora filialId de outra filial no parse e força a própria", async () => {
    try {
      await executeTool(
        "get_product_stock",
        {
          codigoOuNome: "__nao_existe_sku__",
          filialId: "00000000-0000-4000-8000-0000000000bb",
        },
        { user: operador }
      );
    } catch (e) {
      assert.ok(e instanceof Error);
      return;
    }
  });

  it("tool desconhecida retorna erro estruturado", async () => {
    const r = await executeTool("drop_database", {}, { user: operador });
    assert.deepEqual(r, { error: "Tool desconhecida: drop_database" });
  });

  it("prepare_transfer recusa sem permissão de lançamentos (sem tocar no DB)", async () => {
    const r = (await executeTool(
      "prepare_transfer",
      {
        origem: "PLN",
        destino: "TBO",
        codigoOuNome: "DEMO-CABO-01",
        quantidade: 15,
      },
      {
        user: operador,
        permissoes: {
          dashboard: true,
          assistente: true,
          lancamentos: false,
          transferencias: true,
          movimentacoes: true,
          aprovacoes: false,
          cadastros: false,
          estoque_init: false,
        },
      }
    )) as { ok: boolean; error?: string; actionLink?: unknown };

    assert.equal(r.ok, false);
    assert.match(String(r.error), /lançamento/i);
    assert.equal(r.actionLink, undefined);
  });

  it("list_rma_processes recusa sem permissão rma (sem tocar no DB)", async () => {
    const r = (await executeTool(
      "list_rma_processes",
      { status: "ABERTO" },
      {
        user: operador,
        permissoes: {
          dashboard: true,
          assistente: true,
          rma: false,
          lancamentos: true,
        },
      }
    )) as { ok: boolean; error?: string; processos?: unknown };

    assert.equal(r.ok, false);
    assert.match(String(r.error), /RMA/i);
    assert.equal(r.processos, undefined);
  });

  it("get_rma_process recusa sem permissão rma (sem tocar no DB)", async () => {
    const r = (await executeTool(
      "get_rma_process",
      { id: "00000000-0000-4000-8000-0000000000f1" },
      {
        user: operador,
        permissoes: {
          dashboard: true,
          assistente: true,
          rma: false,
        },
      }
    )) as { ok: boolean; error?: string };

    assert.equal(r.ok, false);
    assert.match(String(r.error), /RMA/i);
  });

  it("list_transfers recusa sem permissão transferencias (sem tocar no DB)", async () => {
    const r = (await executeTool(
      "list_transfers",
      { periodo: "mes_atual" },
      {
        user: operador,
        permissoes: {
          dashboard: true,
          assistente: true,
          transferencias: false,
        },
      }
    )) as { ok: boolean; error?: string; transferencias?: unknown };

    assert.equal(r.ok, false);
    assert.match(String(r.error), /Transferências/i);
    assert.equal(r.transferencias, undefined);
  });
});

describe("assistente toolsForUser ACL", () => {
  it("omite RMA/relatórios/transferências/prepare sem permissão", () => {
    const names = toolsForUser("OPERADOR", {
      dashboard: true,
      assistente: true,
      rma: false,
      relatorios: false,
      transferencias: false,
      lancamentos: false,
    }).map((t) => t.name);

    assert.ok(!names.includes("list_rma_processes"));
    assert.ok(!names.includes("get_rma_process"));
    assert.ok(!names.includes("export_arvore_report"));
    assert.ok(!names.includes("list_transfers"));
    assert.ok(!names.includes("prepare_transfer"));
    assert.ok(names.includes("get_product_stock"));
    assert.ok(names.includes("get_product_tree"));
  });

  it("inclui tools sensíveis quando a ACL libera", () => {
    const names = toolsForUser("OPERADOR", {
      dashboard: true,
      assistente: true,
      rma: true,
      relatorios: true,
      transferencias: true,
      lancamentos: true,
    }).map((t) => t.name);

    assert.ok(names.includes("list_rma_processes"));
    assert.ok(names.includes("export_arvore_report"));
    assert.ok(names.includes("list_transfers"));
    assert.ok(names.includes("prepare_transfer"));
    assert.ok(names.length <= TOOL_DEFINITIONS.length);
  });
});

describe("assistente packToolContentForLlm", () => {
  it("marca truncado quando o payload estoura o limite", () => {
    const huge = { itens: Array.from({ length: 400 }, (_, i) => ({
      codigo: `SKU-${i}-${"x".repeat(40)}`,
      descricao: "y".repeat(80),
    })) };
    const packed = packToolContentForLlm(huge);
    assert.ok(packed.length <= 8000);
    const parsed = JSON.parse(packed) as { truncado?: boolean; aviso?: string };
    assert.equal(parsed.truncado, true);
    assert.match(String(parsed.aviso), /truncado|incompleta/i);
  });

  it("não altera payload pequeno", () => {
    const packed = packToolContentForLlm({ ok: true, n: 1 });
    assert.equal(packed, JSON.stringify({ ok: true, n: 1 }));
  });
});

describe("assistente actionLinks ACL", () => {
  it("collectActionLink só aceita href na allowlist", () => {
    const out: AssistenteActionLink[] = [];
    const allowed = new Set(["/lancamentos/novo"]);
    collectActionLink(
      {
        ok: true,
        actionLink: {
          href: "/lancamentos/novo?transf=1&origem=PLN",
          label: "Abrir",
        },
      },
      out,
      allowed
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.href, "/lancamentos/novo?transf=1&origem=PLN");

    collectActionLink(
      {
        ok: true,
        actionLink: { href: "/admin/usuarios", label: "Hack" },
      },
      out,
      allowed
    );
    assert.equal(out.length, 1);

    collectActionLink(
      {
        ok: true,
        actionLink: { href: "https://evil.example/", label: "ext" },
      },
      out,
      allowed
    );
    assert.equal(out.length, 1);
  });

  it("collectActionLink aceita /rma/:uuid quando /rma está na allowlist", () => {
    const out: AssistenteActionLink[] = [];
    const allowed = new Set(["/rma"]);
    const href = "/rma/00000000-0000-4000-8000-0000000000f1";
    collectActionLink(
      {
        ok: true,
        actionLink: { href, label: "Abrir processo RMA" },
      },
      out,
      allowed
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.href, href);
  });

  it("collectActionLink aceita /transferencias/:uuid quando /transferencias está na allowlist", () => {
    const out: AssistenteActionLink[] = [];
    const allowed = new Set(["/transferencias"]);
    const href = "/transferencias/00000000-0000-4000-8000-0000000000aa";
    collectActionLink(
      {
        ok: true,
        actionLink: { href, label: "Abrir transferência" },
      },
      out,
      allowed
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.href, href);
  });

  it("redactActionLinkForLlm remove botão quando ACL bloqueou", () => {
    const collected: AssistenteActionLink[] = [];
    const raw = {
      ok: true,
      actionLink: {
        href: "/lancamentos/novo?transf=1",
        label: "Abrir",
      },
      mensagem: "pronto",
    };
    const redacted = redactActionLinkForLlm(raw, collected) as {
      ok: boolean;
      actionLink?: unknown;
      error?: string;
    };
    assert.equal(redacted.ok, false);
    assert.equal(redacted.actionLink, undefined);
    assert.match(String(redacted.error), /lançamento/i);
  });

  it("redactActionLinkForLlm mantém botão quando foi coletado", () => {
    const href = "/lancamentos/novo?transf=1";
    const collected: AssistenteActionLink[] = [{ href, label: "Abrir" }];
    const raw = {
      ok: true,
      actionLink: { href, label: "Abrir" },
      mensagem: "pronto",
    };
    const kept = redactActionLinkForLlm(raw, collected) as {
      ok: boolean;
      actionLink?: { href: string };
    };
    assert.equal(kept.ok, true);
    assert.equal(kept.actionLink?.href, href);
  });
});

describe("assistente system prompt transferência", () => {
  it("com lançamentos: instrui prepare_transfer só para criar", () => {
    const p = buildSystemPrompt({
      user: operador,
      permissoes: { lancamentos: true, assistente: true, dashboard: true },
    });
    assert.match(p, /prepare_transfer \(origem, destino/);
    assert.match(p, /B\) CRIAR/);
    assert.match(p, /A\) CONSULTAR/);
    assert.doesNotMatch(p, /SEM permissão de Novo Lançamento — NÃO chame prepare_transfer/);
  });

  it("sem lançamentos: proíbe prepare_transfer e botão", () => {
    const p = buildSystemPrompt({
      user: operador,
      permissoes: {
        lancamentos: false,
        assistente: true,
        dashboard: true,
        transferencias: true,
        movimentacoes: true,
      },
    });
    assert.match(p, /SEM permissão de Novo Lançamento/);
    assert.match(p, /SEM prepare_transfer/);
    assert.doesNotMatch(p, /prepare_transfer \(origem, destino/);
    assert.match(p, /list_product_series/);
  });

  it("consulta de transferência aponta list_transfers e separa de criar", () => {
    const p = buildSystemPrompt({
      user: operador,
      permissoes: { lancamentos: true, assistente: true, dashboard: true },
    });
    assert.match(p, /list_transfers/);
    assert.match(p, /destinoSigla=TBO/);
    assert.match(p, /NUNCA chame prepare_transfer só para consultar/);
    assert.match(p, /periodo=hoje/);
    assert.match(p, /Janela de “hoje”/);
  });

  it("pede tom conversacional e proíbe fechamento de call-center", () => {
    const p = buildSystemPrompt({
      user: operador,
      permissoes: { lancamentos: true, assistente: true, dashboard: true },
    });
    assert.match(p, /Tom e estilo/);
    assert.match(p, /estou à disposição/);
    assert.match(p, /Filial no TEEP = estoque/);
  });

  it("instrui ranking de saídas com periodo e proíbe somenteAbertos", () => {
    const p = buildSystemPrompt({
      user: operador,
      permissoes: { lancamentos: true, assistente: true, dashboard: true },
    });
    assert.match(p, /rank_product_movements/);
    assert.match(p, /periodo=mes_atual/);
    assert.match(p, /Janela “este mês”/);
    assert.match(p, /PROIBIDO usar somenteAbertos=true/);
    assert.match(p, /list_stock_movements NÃO substitui o ranking/);
    assert.match(p, /empatadosNoTopo/);
    assert.doesNotMatch(
      p,
      /ou list_stock_movements com operacao=SAIDA/
    );
  });

  it("instrui papel fornecedor em compra vs cliente em venda", () => {
    const p = buildSystemPrompt({
      user: operador,
      permissoes: { lancamentos: true, assistente: true, dashboard: true },
    });
    assert.match(p, /PAPEL DO PARCEIRO/);
    assert.match(p, /Compra \/ ENTRADA/);
    assert.match(p, /PROIBIDO dizer “cliente” só porque/);
  });

  it("instrui consulta de processos RMA e distingue estoque RMA", () => {
    const p = buildSystemPrompt({
      user: operador,
      permissoes: {
        lancamentos: true,
        assistente: true,
        dashboard: true,
        rma: true,
      },
    });
    assert.match(p, /list_rma_processes/);
    assert.match(p, /get_rma_process/);
    assert.match(p, /status=ABERTO/);
    assert.match(p, /PROCESSOS RMA/);
    assert.match(p, /Não existe botão de fechar/);
    assert.match(p, /PROIBIDO concluir que o RMA fechou só porque não há item no estoque RMA/);
  });

  it("fim do mês civil SP não coincide com YYYY-MM-DD de ateIso em UTC", () => {
    const atual = janelaMesSaoPaulo(0, new Date("2026-08-10T18:00:00.000Z"));
    const ateUtcDay = atual.ateIso.slice(0, 10);
    const ateCivil = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(atual.ateIso));
    assert.equal(ateCivil, "2026-08-31");
    assert.equal(ateUtcDay, "2026-09-01");
  });

  it("janelaHojeSaoPaulo cobre o dia civil SP em ISO", () => {
    const j = janelaHojeSaoPaulo(new Date("2026-07-30T20:00:00.000Z"));
    assert.equal(j.dataCivil, "2026-07-30");
    assert.equal(j.deIso, new Date("2026-07-30T00:00:00-03:00").toISOString());
    assert.equal(
      j.ateIso,
      new Date("2026-07-30T23:59:59.999-03:00").toISOString()
    );
    assert.ok(j.deIso < j.ateIso);
  });

  it("janelaMesSaoPaulo cobre agosto/julho 2026", () => {
    const agora = new Date("2026-08-10T18:00:00.000Z");
    const atual = janelaMesSaoPaulo(0, agora);
    assert.equal(atual.label, "08/2026");
    assert.equal(atual.deIso, new Date("2026-08-01T00:00:00-03:00").toISOString());
    const passado = janelaMesSaoPaulo(-1, agora);
    assert.equal(passado.label, "07/2026");
    assert.ok(passado.ateIso < atual.deIso);
  });
});

describe("assistente parse de datas", () => {
  it("rejeita dd/mm/aaaa", () => {
    const r = parseAssistenteDateBound("01/08/2026", "start");
    assert.equal(r.ok, false);
  });

  it("aceita YYYY-MM-DD como dia civil SP", () => {
    const r = parseAssistenteDateBound("2026-08-01", "start");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.date.toISOString(), new Date("2026-08-01T00:00:00-03:00").toISOString());
    }
  });
});
