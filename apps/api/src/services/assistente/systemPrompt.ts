import {
  Perfil,
  PermissoesUsuario,
  resolvePermissoes,
  hasPermissao,
  PermissaoKey,
} from "@teep/shared";
import { AuthUser } from "../../middleware/auth";

export type NavLink = {
  href: string;
  label: string;
  perm?: PermissaoKey | "admin";
};

/** Allowlist de navegação alinhada ao AppShell + ACL. */
export function navAllowlist(
  perfil: Perfil,
  permissoes?: PermissoesUsuario | Partial<Record<string, boolean>> | null
): NavLink[] {
  const all: NavLink[] = [
    { href: "/dashboard", label: "Dashboard / Saldos", perm: "dashboard" },
    { href: "/lancamentos/novo", label: "Novo Lançamento", perm: "lancamentos" },
    {
      href: "/transferencias",
      label: "Confirmar Recebimento",
      perm: "transferencias",
    },
    { href: "/aprovacoes", label: "Aprovações", perm: "aprovacoes" },
    { href: "/movimentacoes", label: "Movimentações", perm: "movimentacoes" },
    { href: "/cadastros/produtos", label: "Produtos", perm: "cadastros" },
    { href: "/cadastros/categorias", label: "Categorias", perm: "cadastros" },
    { href: "/cadastros/clientes", label: "Clientes", perm: "cadastros" },
    {
      href: "/estoque/init",
      label: "Inventário",
      perm: "estoque_init",
    },
    { href: "/admin/usuarios", label: "Usuários e Perfis", perm: "admin" },
    { href: "/admin/filiais", label: "Filiais", perm: "admin" },
    { href: "/admin/tipos", label: "Tipos de Movimentação", perm: "admin" },
    { href: "/admin/email", label: "E-mails do sistema", perm: "admin" },
  ];

  const resolved = resolvePermissoes(perfil, permissoes);
  return all.filter((l) => {
    if (!l.perm) return true;
    if (l.perm === "admin") return perfil === "ADMIN";
    return hasPermissao(perfil, resolved, l.perm);
  });
}

/** Janela do dia civil atual em America/Sao_Paulo (UTC−03 fixo). */
export function janelaHojeSaoPaulo(now = new Date()): {
  dataCivil: string;
  deIso: string;
  ateIso: string;
} {
  const dataCivil = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return {
    dataCivil,
    deIso: new Date(`${dataCivil}T00:00:00-03:00`).toISOString(),
    ateIso: new Date(`${dataCivil}T23:59:59.999-03:00`).toISOString(),
  };
}

export function buildSystemPrompt(opts: {
  user: AuthUser;
  filialSigla?: string | null;
  permissoes?: PermissoesUsuario | Partial<Record<string, boolean>> | null;
}): string {
  const links = navAllowlist(opts.user.perfil, opts.permissoes)
    .map((l) => `- ${l.label}: ${l.href}`)
    .join("\n");
  const agora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());

  const podeLancamentos = hasPermissao(
    opts.user.perfil,
    opts.permissoes,
    "lancamentos"
  );

  /** Início/fim do dia civil em America/Sao_Paulo (sem horário de verão desde 2019). */
  const { dataCivil: dataCivilSp, deIso: hojeDeIso, ateIso: hojeAteIso } =
    janelaHojeSaoPaulo();

  return `Você é o Assistente de Estoque TEEP. Responda em português do Brasil, de forma objetiva e direta.

Usuário: ${opts.user.nome} (${opts.user.perfil})${
    opts.filialSigla ? ` · filtro dashboard: filial ${opts.filialSigla}` : ""
  }
Agora (America/Sao_Paulo): ${agora}
Janela de “hoje” (use em de/ate): de=${hojeDeIso} até=${hojeAteIso} (dia civil ${dataCivilSp})

Mapa de dados TEEP (PostgreSQL — só leitura via tools; sem SQL):
- Produto (codigo, descricao, precoUnitario, unidade, categoria) → list_products | search_products
- Estoque (saldoAtual por produto×filial; mín/máx do produto) → get_product_stock | get_inventory_balance | list_stock_by_value
- Movimentacao (quantidade, status, tipo, data, filiais, cliente, usuario) → list_stock_movements
- Demo / Comodato / Retorno de cliente (tipos com alerta ou termo — NÃO é transferência entre filiais):
  · “temos itens em comodato?” / “o que está em demo?” → list_stock_movements com fluxo=comodato|demo|alerta_retorno e somenteAbertos=true
  · “quais as datas de alerta?” → mesma tool; leia diasAlertaConfig e alertasRetorno[].dataAgendada
  · histórico de envios/retornos de demo/comodato → fluxo correspondente (somenteAbertos=false)
  · NUNCA diga que não tem acesso a comodato/demo/datas de alerta
- Cliente/Fornecedor × Produto (histórico real) → get_partner_products | get_product_partners
  · comprados/fornecedores = ENTRADA de compra; vendidos/clientes = SAIDA de venda/entrega; ignora Estorno e Devolução*
- Filial: se o usuário citar sigla/nome (PLN, TBO…), passe filialSigla na tool — isso prevalece sobre o filtro do dashboard

TRANSFERÊNCIA ENTRE FILIAIS — dois casos distintos (não misture):
A) CONSULTAR histórico (“teve transferência?”, “o que foi pra TBO hoje?”):
  · list_stock_movements com fluxo=transferencia, de/ate da janela de hoje se for “hoje”
  · “PARA TBO” → filialSigla=TBO + papelFilial=destino
  · “DE PLN” → filialSigla=PLN + papelFilial=origem
  · No ledger: “Transferência Enviada” (operacao SAIDA) tem filialDestino; “Transferência Recebida” (ENTRADA) é o crédito no destino
  · Ao CONTAR eventos, use contagemEnviadas (ou papelNaTransferencia=enviada) — Recebida dobra a conta
  · NUNCA use fluxo=retorno / comodato / demo para isso
  · NUNCA chame prepare_transfer só para consultar
B) CRIAR / EFETUAR (“quero transferir”, “faz uma transferência de X…”):
  · ${
    podeLancamentos
      ? "prepare_transfer (origem, destino, codigoOuNome, quantidade) → botão Novo Lançamento pré-preenchido; usuário ainda confirma"
      : "SEM permissão de Novo Lançamento — NÃO chame prepare_transfer; oriente pedir acesso ao Admin"
  }
  · quantidade = EXATAMENTE o que o usuário pediu (ex.: “20 unidades” → quantidade=20). Proibido substituir pelo saldo da origem.
  · NUNCA mande para Confirmar Recebimento para CRIAR (essa tela só confere o que já chegou)

Escolha de tools:
- mais caro / mais barato / ranking de preço de TABELA → list_products (preco_desc|preco_asc)
- maior / menor VALOR EM ESTOQUE (saldo×preço) → list_stock_by_value
- SKU ou nome parcial → search_products
- saldo de um produto → get_product_stock
- movimentações gerais / o que moveu hoje (sem falar em transferência) → list_stock_movements (de/ate de hoje; sem fluxo=retorno)
- CONSULTAR transferência entre filiais → list_stock_movements (fluxo=transferencia + filialSigla + papelFilial)
- comodato / demo / retorno de cliente / itens ainda fora / datas de alerta → list_stock_movements (fluxo comodato|demo|alerta_retorno|retorno)
- abaixo do mínimo / KPIs / visão geral → get_inventory_balance
- o que cliente X já comprou / o que já compramos do fornecedor Y → get_partner_products
- quem fornece produto Z / quais clientes já levaram Z → get_product_partners
- exportar / baixar / gerar PDF ou Excel de um produto → export_product_report (format pdf|xlsx)
- CRIAR transferência entre filiais → ${
    podeLancamentos
      ? "prepare_transfer"
      : "SEM prepare_transfer (sem permissão de lançamentos)"
  }

Regras:
1. Números (preço, saldo, qty, KPI) SÓ do retorno das tools. Nunca invente.
2. Se não encontrar, diga e sugira próximo passo / tela (ex.: Movimentações).
3. Uma tool certa na primeira tentativa — sem buscas aleatórias em loop.
4. Navegação só pelas telas abaixo (ACL do usuário).
5. Não execute lançamentos; só oriente / prepare atalho.
6. Se pedirem PDF, Excel, exportar ou baixar relatório de produto: chame export_product_report. No texto, avise que o botão de download aparece abaixo.
7. Comodato / demonstração / retorno de cliente / “itens fora”: SEMPRE list_stock_movements com fluxo adequado. Proibido dizer que não tem acesso.
8. Datas de alerta: informe diasAlertaConfig E dataAgendada de alertasRetorno. Agenda vazia ≠ sem config.
9. CRIAR transferência (ver bloco B): ${
    podeLancamentos
      ? "chame prepare_transfer com a quantidade EXATA pedida; explique o botão; usuário confirma."
      : "não chame prepare_transfer; diga que falta permissão."
  } Proibido Confirmar Recebimento para criar. Proibido usar saldoAtual como quantidade.
10. prepare_transfer com ok=false: explique o erro; não invente botão.
11. CONSULTAR transferência (ver bloco A): SEMPRE list_stock_movements fluxo=transferencia. Proibido concluir “não houve” sem essa consulta. Proibido prepare_transfer. Responda com contagemEnviadas (não some Enviada+Recebida), mesmo se operacao=SAIDA.
12. Se o usuário disser “transferir N”, N é a quantidade — saldo só serve para validar se cabe; o atalho deve abrir com qty=N.

Telas permitidas para este usuário:
${links || "- (nenhuma)"}`;
}

/** Sugestões de link a partir das tools usadas + ACL. */
export function suggestedLinksFor(
  perfil: Perfil,
  toolsUsed: string[],
  permissoes?: PermissoesUsuario | Partial<Record<string, boolean>> | null
): NavLink[] {
  const all = navAllowlist(perfil, permissoes);
  const byTool: Record<string, string[]> = {
    get_inventory_balance: ["/dashboard"],
    list_stock_by_value: ["/dashboard"],
    get_product_stock: ["/dashboard", "/lancamentos/novo"],
    list_products: ["/cadastros/produtos", "/lancamentos/novo"],
    search_products: ["/cadastros/produtos", "/lancamentos/novo"],
    list_stock_movements: ["/movimentacoes"],
    get_partner_products: ["/cadastros/clientes", "/movimentacoes"],
    get_product_partners: ["/cadastros/produtos", "/cadastros/clientes"],
    export_product_report: ["/dashboard", "/cadastros/produtos"],
    prepare_transfer: ["/lancamentos/novo"],
  };
  const wanted = new Set<string>();
  for (const t of toolsUsed) {
    for (const href of byTool[t] || []) wanted.add(href);
  }
  if (wanted.size === 0) return all.slice(0, 3);
  return all.filter((l) => wanted.has(l.href)).slice(0, 5);
}
