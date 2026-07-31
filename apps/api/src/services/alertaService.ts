import {
  ALERTA_EVENTO_LABELS,
  type AlertaEvento,
} from "@teep/shared";
import { emitirNotificacaoEvento } from "./NotificationService";

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
    },
    dedupeKey: opts.transferenciaId,
  });
}
