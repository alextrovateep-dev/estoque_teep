/** Valor em reais (BRL) para exibição. */
export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Formato numérico pt-BR para campo editável (sem símbolo R$). */
export function formatMoneyPlain(value: number | string | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Interpreta texto digitado (pt-BR ou decimal com ponto) como número. */
export function parseMoneyInput(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;

  let cleaned = s.replace(/[^\d,.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "," || cleaned === ".") {
    return 0;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    cleaned = cleaned.replace(",", ".");
  }

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
