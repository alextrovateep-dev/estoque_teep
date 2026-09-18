import {
  ALERTA_EVENTO_LABELS,
  linhaResponsavel,
  type AlertaEvento,
} from "@teep/shared";
import {
  createInAppNotification,
  emitirNotificacaoEvento,
  notifyUsuarios,
} from "./NotificationService";

export type AlertaUi = {
  evento: AlertaEvento;
  mensagem: string;
};

/** Monta alertas síncronos para a resposta da API (toast do ator). */
export function alertasUiDeLimiares(opts: {
  abaixoMinimo: boolean;
  acimaMaximo: boolean;
  produtoLabel: string;
}): AlertaUi[] {
  const out: AlertaUi[] = [];
  if (opts.abaixoMinimo) {
    out.push({
      evento: "ESTOQUE_MINIMO",
      mensagem: `${opts.produtoLabel}: saldo abaixo do mínimo`,
    });
  }
  if (opts.acimaMaximo) {
    out.push({
      evento: "ESTOQUE_MAXIMO",
      mensagem: `${opts.produtoLabel}: saldo acima do máximo`,
    });
  }
  return out;
}

/**
 * Fanout F9.1: DB → socket → e-mail opcional (async).
 * Mantém API pública usada pelos services de domínio.
 */
export function emitirAlerta(
  evento: AlertaEvento,
  opts: {
    mensagem: string;
    titulo?: string;
    meta?: Record<string, unknown>;
    dedupeKey?: string | null;
  }
): void {
  emitirNotificacaoEvento({
    tipo: evento,
    titulo: opts.titulo || ALERTA_EVENTO_LABELS[evento],
    mensagem: opts.mensagem,
    meta: opts.meta,
    dedupeKey: opts.dedupeKey,
  });
}

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function appBaseUrl(): string {
  return (
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function notificarLimiaresEstoque(opts: {
  abaixoMinimo: boolean;
  acimaMaximo: boolean;
  produtoCodigo: string;
  produtoDescricao?: string;
  filialNome?: string;
  filialSigla?: string;
  saldoAtual?: number;
  estoqueMinimo?: number;
  estoqueMaximo?: number;
  /** Quem fez o movimento que levou o saldo ao limite. */
  responsavelNome?: string | null;
}): void {
  const desc = opts.produtoDescricao?.trim();
  const produto = desc
    ? `${opts.produtoCodigo} — ${desc}`
    : opts.produtoCodigo;
  const local =
    opts.filialSigla && opts.filialNome
      ? `${opts.filialSigla} (${opts.filialNome})`
      : opts.filialSigla || opts.filialNome || "estoque";
  const saldoTxt =
    opts.saldoAtual !== undefined ? fmtQty(opts.saldoAtual) : null;
  const dedupeBase = `${opts.produtoCodigo}|${opts.filialSigla || opts.filialNome || ""}`;
  const link = `${appBaseUrl()}/dashboard`;
  const quem = linhaResponsavel(opts.responsavelNome);

  if (opts.abaixoMinimo) {
    const linhas = [
      `O saldo de ${produto} em ${local} está baixo.`,
      [
        saldoTxt != null ? `Saldo atual: ${saldoTxt}` : null,
        opts.estoqueMinimo != null && opts.estoqueMinimo > 0
          ? `Mínimo cadastrado: ${fmtQty(opts.estoqueMinimo)}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
      quem,
      `Abrir dashboard: ${link}`,
    ].filter((b) => b && String(b).trim());
    emitirAlerta("ESTOQUE_MINIMO", {
      titulo: `Saldo baixo · ${opts.produtoCodigo}`,
      mensagem: linhas.join("\n\n"),
      meta: {
        produtoCodigo: opts.produtoCodigo,
        filialNome: opts.filialNome,
        filialSigla: opts.filialSigla,
        saldoAtual: opts.saldoAtual,
        estoqueMinimo: opts.estoqueMinimo,
        href: "/dashboard",
      },
      dedupeKey: `${dedupeBase}|MIN`,
    });
  }
  if (opts.acimaMaximo) {
    const linhas = [
      `O saldo de ${produto} em ${local} ultrapassou o máximo.`,
      [
        saldoTxt != null ? `Saldo atual: ${saldoTxt}` : null,
        opts.estoqueMaximo != null && opts.estoqueMaximo > 0
          ? `Máximo cadastrado: ${fmtQty(opts.estoqueMaximo)}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
      quem,
      `Abrir dashboard: ${link}`,
    ].filter((b) => b && String(b).trim());
    emitirAlerta("ESTOQUE_MAXIMO", {
      titulo: `Saldo alto · ${opts.produtoCodigo}`,
      mensagem: linhas.join("\n\n"),
      meta: {
        produtoCodigo: opts.produtoCodigo,
        filialNome: opts.filialNome,
        filialSigla: opts.filialSigla,
        saldoAtual: opts.saldoAtual,
        estoqueMaximo: opts.estoqueMaximo,
        href: "/dashboard",
      },
      dedupeKey: `${dedupeBase}|MAX`,
    });
  }
}

function fmtMoneyBr(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function notificarPrecoAjustado(opts: {
  produtoId?: string;
  produtoCodigo: string;
  produtoDescricao: string;
  precoAnterior: number;
  precoNovo: number;
  responsavelNome?: string | null;
}): void {
  const delta = opts.precoNovo - opts.precoAnterior;
  const pct =
    opts.precoAnterior !== 0
      ? (delta / Math.abs(opts.precoAnterior)) * 100
      : null;
  const variacao =
    pct != null && Number.isFinite(pct)
      ? ` (${delta >= 0 ? "+" : ""}${pct.toLocaleString("pt-BR", {
          maximumFractionDigits: 1,
          minimumFractionDigits: 0,
        })}%)`
      : "";
  const quem = linhaResponsavel(opts.responsavelNome);
  const href = opts.produtoId
    ? `/cadastros/produtos/${opts.produtoId}`
    : "/cadastros/produtos";
  const link = `${appBaseUrl()}${href}`;

  emitirAlerta("PRECO_AJUSTADO", {
    titulo: `Preço atualizado · ${opts.produtoCodigo}`,
    mensagem: [
      `O preço de ${opts.produtoCodigo} — ${opts.produtoDescricao} foi alterado.`,
      `De ${fmtMoneyBr(opts.precoAnterior)} para ${fmtMoneyBr(opts.precoNovo)}${variacao}.`,
      quem,
      `Cadastro do produto: ${link}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    meta: {
      ...opts,
      href,
    },
    dedupeKey: `${opts.produtoCodigo}|PRECO|${opts.precoNovo}`,
  });
}

export function notificarDivergenciaTransferencia(opts: {
  transferenciaId: string;
  origemNome: string;
  destinoNome: string;
  resumoItens: string;
  responsavelNome?: string | null;
}): void {
  const short = opts.transferenciaId.slice(0, 8);
  const href = `/transferencias/${opts.transferenciaId}`;
  emitirAlerta("DIVERGENCIA_TRANSFERENCIA", {
    titulo: `Divergência na transferência · ${short}`,
    mensagem: [
      `A conferência da transferência ${short} encontrou diferença entre o enviado e o recebido.`,
      `Rota: ${opts.origemNome} → ${opts.destinoNome}.`,
      opts.resumoItens.trim() || null,
      linhaResponsavel(opts.responsavelNome),
      `Abrir transferência: ${appBaseUrl()}${href}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    meta: {
      transferenciaId: opts.transferenciaId,
      href,
    },
    dedupeKey: opts.transferenciaId,
  });
}

export function notificarTransferenciaPendenteAprovacao(opts: {
  transferenciaId: string;
  origemNome: string;
  destinoNome: string;
  responsavelNome?: string | null;
  qtdItens: number;
}): void {
  const short = opts.transferenciaId.slice(0, 8);
  const href = `/transferencias/${opts.transferenciaId}`;
  const quem = linhaResponsavel(opts.responsavelNome);
  emitirAlerta("TRANSFERENCIA_PENDENTE_APROVACAO", {
    titulo: `Transferência aguardando aprovação · ${short}`,
    mensagem: [
      `Há uma transferência (${short}) esperando sua aprovação.`,
      `De ${opts.origemNome} para ${opts.destinoNome} · ${opts.qtdItens} item(ns).`,
      quem,
      `Aprovar transferência: ${appBaseUrl()}${href}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    meta: {
      transferenciaId: opts.transferenciaId,
      href,
    },
    dedupeKey: `${opts.transferenciaId}|PENDENTE`,
  });
}

export function notificarTransferenciaDecisao(opts: {
  transferenciaId: string;
  origemNome: string;
  destinoNome: string;
  aprovado: boolean;
  motivo?: string | null;
  responsavelNome?: string | null;
  /** Avisa também o criador no sino (mesmo sem tick). */
  criadoPorId?: string | null;
}): void {
  const short = opts.transferenciaId.slice(0, 8);
  const tipo = opts.aprovado
    ? "TRANSFERENCIA_APROVADA"
    : "TRANSFERENCIA_REJEITADA";
  const href = `/transferencias/${opts.transferenciaId}`;
  const quem = linhaResponsavel(opts.responsavelNome);
  const titulo = opts.aprovado
    ? `Transferência aprovada · ${short}`
    : `Transferência rejeitada · ${short}`;
  const mensagem = [
    opts.aprovado
      ? `A transferência ${short} foi aprovada.`
      : `A transferência ${short} foi rejeitada.`,
    `Rota: ${opts.origemNome} → ${opts.destinoNome}.`,
    !opts.aprovado && opts.motivo?.trim()
      ? `Motivo: ${opts.motivo.trim()}`
      : null,
    quem,
    `Abrir transferência: ${appBaseUrl()}${href}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const meta = {
    transferenciaId: opts.transferenciaId,
    href,
  };
  emitirAlerta(tipo, {
    titulo,
    mensagem,
    meta,
    dedupeKey: `${opts.transferenciaId}|${opts.aprovado ? "OK" : "NOK"}`,
  });
  if (opts.criadoPorId) {
    createInAppNotification(opts.criadoPorId, {
      tipo,
      titulo,
      mensagem,
      meta,
      dedupeKey: `${opts.transferenciaId}|${opts.aprovado ? "OK" : "NOK"}|CRIADOR`,
    });
  }
}

export function notificarRmaAberto(opts: {
  processoId: string;
  clienteNome: string;
  qtdItens: number;
  responsavelNome?: string | null;
  destinatarioIds: string[];
  nfEntradaNumero?: string | null;
  itensResumo?: string[];
}): void {
  const short = opts.processoId.slice(0, 8);
  const href = `/rma/${opts.processoId}`;
  const quem = linhaResponsavel(opts.responsavelNome);
  const itens =
    opts.itensResumo && opts.itensResumo.length > 0
      ? opts.itensResumo.slice(0, 3).join("; ") +
        (opts.itensResumo.length > 3
          ? ` (+${opts.itensResumo.length - 3})`
          : "")
      : null;
  const linhas = [
    `Um novo RMA (${short}) foi aberto para ${opts.clienteNome}.`,
    [
      `${opts.qtdItens} item(ns)`,
      opts.nfEntradaNumero?.trim()
        ? `NF de entrada: ${opts.nfEntradaNumero.trim()}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
    quem,
    itens ? `Itens: ${itens}` : null,
    `Abrir RMA: ${appBaseUrl()}${href}`,
  ].filter(Boolean) as string[];

  notifyUsuarios(opts.destinatarioIds, {
    tipo: "RMA_ABERTO",
    titulo: `Novo RMA · ${short}`,
    mensagem: linhas.join("\n\n"),
    meta: { processoId: opts.processoId, href },
    dedupeKey: `${opts.processoId}|ABERTO`,
    forceEmail: true,
  });
}

export function notificarRmaFinanceiro(opts: {
  processoId: string;
  clienteNome: string;
  cobrou: boolean;
  valorCobrado?: number | null;
  nfCobrancaNumero?: string | null;
  destinatarioIds: string[];
  responsavelNome?: string | null;
}): void {
  const short = opts.processoId.slice(0, 8);
  const href = `/rma/${opts.processoId}`;
  const detalhe = opts.cobrou
    ? [
        "Há cobrança registrada neste RMA.",
        [
          opts.valorCobrado != null
            ? `Valor: ${fmtMoneyBr(Number(opts.valorCobrado))}`
            : null,
          opts.nfCobrancaNumero?.trim()
            ? `NF de cobrança: ${opts.nfCobrancaNumero.trim()}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      ]
        .filter(Boolean)
        .join("\n")
    : "Os dados financeiros do RMA foram atualizados (sem cobrança).";
  notifyUsuarios(opts.destinatarioIds, {
    tipo: "RMA_FINANCEIRO",
    titulo: `RMA — financeiro · ${short}`,
    mensagem: [
      `Atualização financeira no RMA ${short} (${opts.clienteNome}).`,
      detalhe,
      linhaResponsavel(opts.responsavelNome),
      `Abrir RMA: ${appBaseUrl()}${href}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    meta: { processoId: opts.processoId, href },
    dedupeKey: `${opts.processoId}|FIN|${opts.cobrou}|${opts.valorCobrado ?? ""}|${opts.nfCobrancaNumero ?? ""}`,
    forceEmail: true,
  });
}

export function notificarRmaEncerrado(opts: {
  processoId: string;
  clienteNome: string;
  status: "FECHADO" | "CANCELADO";
  destinatarioIds: string[];
  responsavelNome?: string | null;
}): void {
  const short = opts.processoId.slice(0, 8);
  const href = `/rma/${opts.processoId}`;
  const fechado = opts.status === "FECHADO";
  notifyUsuarios(opts.destinatarioIds, {
    tipo: "RMA_ENCERRADO",
    titulo: fechado
      ? `RMA fechado · ${short}`
      : `RMA cancelado · ${short}`,
    mensagem: [
      fechado
        ? `O RMA ${short} de ${opts.clienteNome} foi fechado.`
        : `O RMA ${short} de ${opts.clienteNome} foi cancelado.`,
      linhaResponsavel(opts.responsavelNome),
      `Abrir RMA: ${appBaseUrl()}${href}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    meta: {
      processoId: opts.processoId,
      status: opts.status,
      href,
    },
    dedupeKey: `${opts.processoId}|${opts.status}`,
    forceEmail: true,
  });
}

export function notificarRmaLaudos(opts: {
  processoId: string;
  clienteNome: string;
  destinatarioIds: string[];
  laudosResumo: string[];
  responsavelNome?: string | null;
}): void {
  const short = opts.processoId.slice(0, 8);
  const href = `/rma/${opts.processoId}`;
  const lista =
    opts.laudosResumo.length > 0
      ? opts.laudosResumo.map((l) => `• ${l}`).join("\n")
      : "• (sem detalhe dos itens)";
  notifyUsuarios(opts.destinatarioIds, {
    tipo: "RMA_LAUDO",
    titulo: `Laudo disponível no RMA · ${short}`,
    mensagem: [
      `Há diagnóstico(s) / laudo(s) no RMA ${short} (${opts.clienteNome}).`,
      lista,
      linhaResponsavel(opts.responsavelNome),
      `Abrir RMA: ${appBaseUrl()}${href}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    meta: { processoId: opts.processoId, href },
    dedupeKey: `${opts.processoId}|LAUDO|${Date.now()}`,
    forceEmail: true,
  });
}

/** Orçamento fechado (ENVIADO) — pronto para PDF / negociação com o cliente. */
export function notificarRmaOrcamentoPronto(opts: {
  processoId: string;
  clienteNome: string;
  destinatarioIds: string[];
  itensResumo: string[];
  responsavelNome?: string | null;
}): void {
  const short = opts.processoId.slice(0, 8);
  const href = `/rma/${opts.processoId}/orcamento`;
  const lista =
    opts.itensResumo.length > 0
      ? opts.itensResumo.map((l) => `• ${l}`).join("\n")
      : "• (itens do orçamento)";
  const quem = linhaResponsavel(opts.responsavelNome);
  notifyUsuarios(opts.destinatarioIds, {
    tipo: "RMA_ORCAMENTO",
    titulo: `Orçamento pronto · ${short}`,
    mensagem: [
      `O orçamento do RMA ${short} (${opts.clienteNome}) foi fechado e está pronto para negociar com o cliente.`,
      lista,
      quem,
      "Gere o PDF na tela de orçamento e envie ao cliente (e-mail/WhatsApp).",
      `Abrir orçamento do RMA: ${appBaseUrl()}${href}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    meta: { processoId: opts.processoId, href },
    dedupeKey: `${opts.processoId}|ORC|${opts.itensResumo.join("|")}`,
    forceEmail: true,
  });
}

/** Decisão comercial do orçamento (aprovado ou recusado). */
export function notificarRmaOrcamentoDecisao(opts: {
  processoId: string;
  clienteNome: string;
  destinatarioIds: string[];
  decisao: "APROVADO" | "RECUSADO";
  itemResumo: string;
  total?: number | null;
  responsavelNome?: string | null;
  observacao?: string | null;
}): void {
  const short = opts.processoId.slice(0, 8);
  const href = `/rma/${opts.processoId}`;
  const aprovado = opts.decisao === "APROVADO";
  const valor =
    aprovado && opts.total != null && opts.total > 0
      ? ` · ${fmtMoneyBr(opts.total)}`
      : "";
  const quem = linhaResponsavel(opts.responsavelNome);
  const obs = opts.observacao?.trim()
    ? `Obs.: ${opts.observacao.trim()}`
    : null;
  notifyUsuarios(opts.destinatarioIds, {
    tipo: "RMA_ORCAMENTO_DECISAO",
    titulo: aprovado
      ? `Orçamento aprovado · ${short}`
      : `Orçamento recusado · ${short}`,
    mensagem: [
      `Decisão no orçamento do RMA ${short} (${opts.clienteNome}).`,
      `• ${opts.itemResumo} — ${aprovado ? "Aprovado" : "Recusado"}${valor}`,
      quem,
      obs,
      `Abrir RMA: ${appBaseUrl()}${href}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    meta: {
      processoId: opts.processoId,
      decisao: opts.decisao,
      href,
    },
    dedupeKey: `${opts.processoId}|ORC_DEC|${opts.itemResumo}|${opts.decisao}`,
    forceEmail: true,
  });
}

export function notificarPedidoSeparado(opts: {
  pedidoId: string;
  egestorCodigo: number;
  clienteNome: string;
  filialSigla: string;
  destinatarioIds: string[];
  responsavelNome?: string | null;
}): void {
  const href = `/pedidos/${opts.pedidoId}`;
  notifyUsuarios(opts.destinatarioIds, {
    tipo: "PEDIDO_SEPARADO",
    titulo: `Pedido separado · ${opts.egestorCodigo}`,
    mensagem: [
      `O pedido ${opts.egestorCodigo} foi separado e o estoque já foi baixado.`,
      `Cliente: ${opts.clienteNome}`,
      `Estoque: ${opts.filialSigla}`,
      linhaResponsavel(opts.responsavelNome),
      `Abrir pedido: ${appBaseUrl()}${href}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    meta: { pedidoId: opts.pedidoId, href },
    dedupeKey: `${opts.pedidoId}|SEPARADO`,
    forceEmail: true,
  });
}