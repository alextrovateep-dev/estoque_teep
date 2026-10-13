import { TRANSFERENCIA_STATUS } from "@teep/shared";

export type PeriodoTransferencia = "hoje" | "mes_atual" | "mes_passado";

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

const PERIODO_ALIASES: Record<string, PeriodoTransferencia> = {
  hoje: "hoje",
  "este mes": "mes_atual",
  "mes atual": "mes_atual",
  mes_atual: "mes_atual",
  periodo: "mes_atual",
  "no periodo": "mes_atual",
  "neste periodo": "mes_atual",
  "mes passado": "mes_passado",
  "ultimo mes": "mes_passado",
  mes_passado: "mes_passado",
};

/** Consulta de histórico — não confundir com “quero transferir”. */
export function inferConsultaTransferencias(
  message: string
): { periodo: PeriodoTransferencia } | null {
  const t = fold(message);
  if (!/transferenc/.test(t)) return null;

  const querCriar =
    /\b(transferir|quero transfer|vamos transfer|faz(er)? uma transfer|nova transfer|preparar transfer)\b/.test(
      t
    ) && !/\b(realizad|efetuad|listar|quais|teve|houve|consulta|historico)\b/.test(t);
  if (querCriar) return null;

  const consulta =
    /\b(realizad|efetuad|listar|quais|qual|teve|houve|consulta|consultar|historico|periodo|hoje|este mes|mes passado)\b/.test(
      t
    ) || /\btransferencias\b/.test(t);
  if (!consulta) return null;

  let periodo: PeriodoTransferencia = "mes_atual";
  if (/\bhoje\b/.test(t)) periodo = "hoje";
  else if (/\b(mes passado|ultimo mes)\b/.test(t)) periodo = "mes_passado";
  return { periodo };
}

export function coercePeriodoTransferencia(
  raw: unknown
): PeriodoTransferencia | undefined {
  if (raw == null) return undefined;
  const k = fold(String(raw)).replace(/[_-]+/g, " ").trim();
  if (!k) return undefined;
  if (k in PERIODO_ALIASES) return PERIODO_ALIASES[k];
  return undefined;
}

export function coerceStatusTransferencia(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if ((TRANSFERENCIA_STATUS as readonly string[]).includes(s)) return s;
  return undefined;
}

/** Preenche periodo=mes_atual quando a tool veio sem janela (pergunta “no período”). */
export function normalizeListTransfersRaw(raw: unknown): Record<string, unknown> {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  const periodo = coercePeriodoTransferencia(o.periodo);
  if (periodo) o.periodo = periodo;
  else delete o.periodo;
  const status = coerceStatusTransferencia(o.status);
  if (status) o.status = status;
  else delete o.status;
  const temData =
    String(o.dataInicio ?? "").trim().length >= 8 ||
    String(o.dataFim ?? "").trim().length >= 8;
  if (!o.periodo && !temData) o.periodo = "mes_atual";
  return o;
}

type ItemChat = {
  codigo?: string;
  descricao?: string;
  qtdEnviada?: number;
  qtdRecebida?: number | null;
};

type CargaChat = {
  sentido?: string;
  origem?: string;
  destino?: string;
  statusLabel?: string;
  criadoEmSp?: string;
  itens?: ItemChat[];
};

/** Resposta determinística para a IA não “sumir” com a lista. */
export function formatarListaTransferenciasChat(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.ok === false) {
    const err = String(p.error || p.mensagem || "").trim();
    return err || "Não consegui consultar as transferências.";
  }
  if (!Array.isArray(p.transferencias)) return null;

  const periodo =
    p.periodo === "hoje"
      ? "hoje"
      : p.periodo === "mes_passado"
        ? "no mês passado"
        : "neste período";
  const rows = p.transferencias as CargaChat[];
  const total = typeof p.total === "number" ? p.total : rows.length;

  if (rows.length === 0) {
    return `Não encontrei transferências ${periodo} entre estoques.`;
  }

  const linhas = rows.map((t) => {
    const sentido =
      t.sentido ||
      [t.origem, t.destino].filter(Boolean).join(" → ") ||
      "origem → destino";
    const quando = t.criadoEmSp || "";
    const st = t.statusLabel || "";
    const itens = (t.itens || [])
      .map((i) => {
        const qtd = i.qtdEnviada ?? i.qtdRecebida;
        const nome = [i.codigo, i.descricao].filter(Boolean).join(" — ");
        return qtd != null ? `${nome} (${qtd})` : nome;
      })
      .filter(Boolean)
      .join("; ");
    return `• ${quando} ${sentido} — ${st}${itens ? `\n  ${itens}` : ""}`.trim();
  });

  const extra =
    p.truncado === true
      ? `\n\nLista parcial (${rows.length} de ${total}).`
      : "";
  return `Transferências ${periodo} (${total}):\n\n${linhas.join("\n")}${extra}`;
}

/** Usa a lista da tool quando o modelo responde vazio ou diz que não há dados. */
export function escolherReplyTransferencias(
  replyLlm: string,
  payload: unknown,
  injetouConsulta: boolean
): string {
  const formatted = formatarListaTransferenciasChat(payload);
  if (!formatted) return replyLlm;
  const n =
    payload &&
    typeof payload === "object" &&
    typeof (payload as { encontrados?: unknown }).encontrados === "number"
      ? (payload as { encontrados: number }).encontrados
      : 0;
  const vazio =
    !replyLlm.trim() ||
    /não consegui montar|tente reformular|consultei o estoque, mas não consegui/i.test(
      replyLlm
    );
  const nega =
    /não (encontrei|h[aá]|houve|tenho)|nenhuma transfer|sem (informa|dados|resposta)/i.test(
      replyLlm
    );
  if (injetouConsulta || vazio || (n > 0 && nega)) return formatted;
  return replyLlm;
}
