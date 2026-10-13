import { isUuid } from "./assistenteScope";

/** Se filialId não for UUID (ex.: “Vendas”), usa como nome/sigla. */
export function normalizeFilialToolArgs(raw: unknown): Record<string, unknown> {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  const id = o.filialId != null ? String(o.filialId).trim() : "";
  if (!id) {
    if (o.filialId === "" || o.filialId == null) delete o.filialId;
    return o;
  }
  if (!isUuid(id)) {
    if (!String(o.filialSigla ?? "").trim()) o.filialSigla = id;
    delete o.filialId;
  }
  return o;
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** “quantos TMP-1144-W no estoque de Vendas?” */
export function inferConsultaSaldo(message: string): {
  codigoOuNome: string;
  filialSigla?: string;
} | null {
  const t = fold(message);
  const querSaldo =
    /\b(quantos|quantidade|saldo|tem no estoque|no estoque|em estoque|modulos|m[oó]dulos)\b/.test(
      t
    ) || /\bestoque\s+d[eoa]\b/.test(t);
  if (!querSaldo) return null;

  const sku = message.match(/\b[A-Z]{2,}\d*[A-Z0-9]*(?:-[A-Z0-9]+){1,}\b/i);
  if (!sku) return null;

  const estoqueDe = message.match(
    /\bestoque\s+d[eoa]\s+([A-Za-zÀ-ú0-9][A-Za-zÀ-ú0-9._-]*)/i
  );
  const filialSigla = estoqueDe?.[1]?.trim();
  return {
    codigoOuNome: sku[0],
    ...(filialSigla ? { filialSigla } : {}),
  };
}

type SaldoLinha = {
  filialSigla?: string;
  filialNome?: string;
  qty?: number;
};

export function formatarSaldoProdutoChat(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.encontrado === false || p.ok === false) {
    const msg = String(p.mensagem || p.error || "").trim();
    return msg || "Não encontrei esse produto no cadastro.";
  }
  if (p.encontrado !== true && !p.produto) return null;

  const prod = (p.produto || {}) as {
    codigo?: string;
    descricao?: string;
    unidade?: string;
  };
  const saldos = Array.isArray(p.saldos) ? (p.saldos as SaldoLinha[]) : [];
  const unidade = prod.unidade || "UN";
  const codigo = prod.codigo || "";
  const nome = prod.descricao ? `${codigo} (${prod.descricao})` : codigo;

  if (saldos.length === 1) {
    const s = saldos[0]!;
    const onde = s.filialNome || s.filialSigla || "estoque";
    return `${nome}: ${s.qty ?? 0} ${unidade} em ${onde}.`;
  }
  if (saldos.length === 0) {
    return `${nome}: 0 ${unidade} (sem posição de estoque).`;
  }
  const linhas = saldos
    .map((s) => `• ${s.filialSigla || s.filialNome}: ${s.qty ?? 0} ${unidade}`)
    .join("\n");
  const total = typeof p.qtyTotal === "number" ? p.qtyTotal : null;
  return `${nome}${total != null ? ` — total ${total} ${unidade}` : ""}:\n${linhas}`;
}

export function escolherReplySaldo(
  replyLlm: string,
  payload: unknown,
  injetou: boolean
): string {
  const formatted = formatarSaldoProdutoChat(payload);
  if (!formatted) return replyLlm;
  const vazio =
    !replyLlm.trim() ||
    /não consegui montar|tente reformular|erro (na )?api|falha na tool/i.test(
      replyLlm
    );
  const nega =
    /não (encontrei|consegui|tenho|há)|sem (informa|dados|resposta)/i.test(
      replyLlm
    );
  if (injetou || vazio || nega) return formatted;
  return replyLlm;
}
