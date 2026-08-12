import {
  ALERTA_EVENTO_LABELS,
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
      mensagem: `${opts.produtoLabel} abaixo do estoque mínimo`,
    });
  }
  if (opts.acimaMaximo) {
    out.push({
      evento: "ESTOQUE_MAXIMO",
      mensagem: `${opts.produtoLabel} acima do estoque máximo`,
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

export function notificarLimiaresEstoque(opts: {
  abaixoMinimo: boolean;
  acimaMaximo: boolean;
  produtoCodigo: string;
  produtoDescricao?: string;
  filialNome?: string;
  saldoAtual?: number;
}): void {
  const label = opts.produtoDescricao
    ? `${opts.produtoCodigo} (${opts.produtoDescricao})`
    : opts.produtoCodigo;
  const local = opts.filialNome ? ` em ${opts.filialNome}` : "";
  const saldo =
    opts.saldoAtual !== undefined ? ` (saldo: ${opts.saldoAtual})` : "";
  const dedupeBase = `${opts.produtoCodigo}|${opts.filialNome || ""}`;

  if (opts.abaixoMinimo) {
    emitirAlerta("ESTOQUE_MINIMO", {
      titulo: `${ALERTA_EVENTO_LABELS.ESTOQUE_MINIMO} · ${opts.produtoCodigo}`,
      mensagem: `Produto ${label}${local} está abaixo do estoque mínimo${saldo}.`,
      meta: {
        produtoCodigo: opts.produtoCodigo,
        filialNome: opts.filialNome,
        saldoAtual: opts.saldoAtual,
      },
      dedupeKey: `${dedupeBase}|MIN`,
    });
  }
  if (opts.acimaMaximo) {
    emitirAlerta("ESTOQUE_MAXIMO", {
      titulo: `${ALERTA_EVENTO_LABELS.ESTOQUE_MAXIMO} · ${opts.produtoCodigo}`,
      mensagem: `Produto ${label}${local} está acima do estoque máximo${saldo}.`,
      meta: {
        produtoCodigo: opts.produtoCodigo,
        filialNome: opts.filialNome,
        saldoAtual: opts.saldoAtual,
      },
      dedupeKey: `${dedupeBase}|MAX`,
    });
  }
}

export function notificarPrecoAjustado(opts: {
  produtoCodigo: string;
  produtoDescricao: string;
  precoAnterior: number;
  precoNovo: number;
}): void {
  emitirAlerta("PRECO_AJUSTADO", {
    titulo: `${ALERTA_EVENTO_LABELS.PRECO_AJUSTADO} · ${opts.produtoCodigo}`,
    mensagem: `Preço de ${opts.produtoCodigo} (${opts.produtoDescricao}) alterado de R$ ${opts.precoAnterior.toFixed(2)} para R$ ${opts.precoNovo.toFixed(2)}.`,
    meta: opts,
    dedupeKey: `${opts.produtoCodigo}|PRECO|${opts.precoNovo}`,
  });
}

export function notificarDivergenciaTransferencia(opts: {
  transferenciaId: string;
  origemNome: string;
  destinoNome: string;
  resumoItens: string;
}): void {
  const short = opts.transferenciaId.slice(0, 8);
  emitirAlerta("DIVERGENCIA_TRANSFERENCIA", {
    mensagem: `Divergência na transferência ${short}: ${opts.origemNome} → ${opts.destinoNome}. ${opts.resumoItens}`,
    meta: {
      transferenciaId: opts.transferenciaId,
      href: `/transferencias/${opts.transferenciaId}`,
    },
    dedupeKey: opts.transferenciaId,
  });
}

export function notificarTransferenciaPendenteAprovacao(opts: {
  transferenciaId: string;
  origemNome: string;
  destinoNome: string;
  criadoPorNome?: string;
  qtdItens: number;
}): void {
  const short = opts.transferenciaId.slice(0, 8);
  const quem = opts.criadoPorNome ? ` por ${opts.criadoPorNome}` : "";
  emitirAlerta("TRANSFERENCIA_PENDENTE_APROVACAO", {
    titulo: `${ALERTA_EVENTO_LABELS.TRANSFERENCIA_PENDENTE_APROVACAO} · ${short}`,
    mensagem: `Transferência ${short}${quem}: ${opts.origemNome} → ${opts.destinoNome} (${opts.qtdItens} item(ns)). Aguardando aprovação.`,
    meta: {
      transferenciaId: opts.transferenciaId,
      href: `/transferencias/${opts.transferenciaId}`,
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
  decididoPorNome?: string;
  /** Avisa também o criador no sino (mesmo sem tick). */
  criadoPorId?: string | null;
}): void {
  const short = opts.transferenciaId.slice(0, 8);
  const tipo = opts.aprovado
    ? "TRANSFERENCIA_APROVADA"
    : "TRANSFERENCIA_REJEITADA";
  const quem = opts.decididoPorNome ? ` por ${opts.decididoPorNome}` : "";
  const motivo =
    !opts.aprovado && opts.motivo ? ` Motivo: ${opts.motivo}` : "";
  const mensagem = opts.aprovado
    ? `Transferência ${short} aprovada${quem}: ${opts.origemNome} → ${opts.destinoNome}.`
    : `Transferência ${short} rejeitada${quem}: ${opts.origemNome} → ${opts.destinoNome}.${motivo}`;
  const meta = {
    transferenciaId: opts.transferenciaId,
    href: `/transferencias/${opts.transferenciaId}`,
  };
  emitirAlerta(tipo, {
    titulo: `${ALERTA_EVENTO_LABELS[tipo]} · ${short}`,
    mensagem,
    meta,
    dedupeKey: `${opts.transferenciaId}|${opts.aprovado ? "OK" : "NOK"}`,
  });
  if (opts.criadoPorId) {
    createInAppNotification(opts.criadoPorId, {
      tipo,
      titulo: `${ALERTA_EVENTO_LABELS[tipo]} · ${short}`,
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
  criadoPorNome?: string;
  destinatarioIds: string[];
  nfEntradaNumero?: string | null;
  itensResumo?: string[];
}): void {
  const short = opts.processoId.slice(0, 8);
  const quem = opts.criadoPorNome ? ` por ${opts.criadoPorNome}` : "";
  const appUrl =
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    "http://localhost:3000";
  const linhas = [
    `RMA ${short} aberto${quem}.`,
    `Cliente: ${opts.clienteNome}`,
    `Itens: ${opts.qtdItens}`,
    opts.nfEntradaNumero?.trim()
      ? `NF entrada: ${opts.nfEntradaNumero.trim()}`
      : null,
    opts.itensResumo && opts.itensResumo.length > 0
      ? opts.itensResumo.slice(0, 3).join("; ") +
        (opts.itensResumo.length > 3
          ? ` (+${opts.itensResumo.length - 3})`
          : "")
      : null,
    `Abrir no sistema: ${appUrl}/rma/${opts.processoId}`,
  ].filter(Boolean) as string[];

  notifyUsuarios(opts.destinatarioIds, {
    tipo: "RMA_ABERTO",
    titulo: `${ALERTA_EVENTO_LABELS.RMA_ABERTO} · ${short}`,
    mensagem: linhas.join("\n"),
    meta: { processoId: opts.processoId, href: `/rma/${opts.processoId}` },
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
}): void {
  const short = opts.processoId.slice(0, 8);
  const detalhe = opts.cobrou
    ? `Cobranca registrada${
        opts.valorCobrado != null
          ? ` — R$ ${Number(opts.valorCobrado).toFixed(2)}`
          : ""
      }${opts.nfCobrancaNumero ? ` · NF ${opts.nfCobrancaNumero}` : ""}.`
    : "Dados financeiros atualizados (sem cobranca).";
  notifyUsuarios(opts.destinatarioIds, {
    tipo: "RMA_FINANCEIRO",
    titulo: `${ALERTA_EVENTO_LABELS.RMA_FINANCEIRO} · ${short}`,
    mensagem: `RMA ${short} (${opts.clienteNome}): ${detalhe}`,
    meta: { processoId: opts.processoId, href: `/rma/${opts.processoId}` },
    dedupeKey: `${opts.processoId}|FIN|${opts.cobrou}|${opts.valorCobrado ?? ""}|${opts.nfCobrancaNumero ?? ""}`,
    forceEmail: true,
  });
}

export function notificarRmaEncerrado(opts: {
  processoId: string;
  clienteNome: string;
  status: "FECHADO" | "CANCELADO";
  destinatarioIds: string[];
}): void {
  const short = opts.processoId.slice(0, 8);
  const label = opts.status === "FECHADO" ? "fechado" : "cancelado";
  notifyUsuarios(opts.destinatarioIds, {
    tipo: "RMA_ENCERRADO",
    titulo: `${ALERTA_EVENTO_LABELS.RMA_ENCERRADO} · ${short}`,
    mensagem: `RMA ${short} (${opts.clienteNome}) foi ${label}.`,
    meta: {
      processoId: opts.processoId,
      status: opts.status,
      href: `/rma/${opts.processoId}`,
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
}): void {
  const short = opts.processoId.slice(0, 8);
  const appUrl =
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    "http://localhost:3000";
  const linhas = [
    `RMA ${short} (${opts.clienteNome}): laudo(s) disponiveis.`,
    ...(opts.laudosResumo.length > 0
      ? opts.laudosResumo.map((l) => `  - ${l}`)
      : ["  (sem detalhe de itens)"]),
    `Abrir no sistema (anexos): ${appUrl}/rma/${opts.processoId}`,
  ];
  notifyUsuarios(opts.destinatarioIds, {
    tipo: "RMA_LAUDO",
    titulo: `${ALERTA_EVENTO_LABELS.RMA_LAUDO} · ${short}`,
    mensagem: linhas.join("\n"),
    meta: { processoId: opts.processoId, href: `/rma/${opts.processoId}` },
    dedupeKey: `${opts.processoId}|LAUDO|${Date.now()}`,
    forceEmail: true,
  });
}