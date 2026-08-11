/** Status de UnidadeSerie (rastreio físico). */
export const UNIDADE_SERIE_STATUS_LABEL: Record<string, string> = {
  EM_ESTOQUE: "Em estoque",
  EM_TRANSITO: "Em trânsito",
  SAIDO: "Saído",
};

export type UnidadeSerieLocal = {
  status: string;
  filial?: { sigla: string; nome: string } | null;
  cliente?: { nome: string } | null;
  emTransito?: {
    origemSigla: string;
    destinoSigla: string;
  } | null;
};

/** Texto de local atual da unidade (estoque / trânsito / cliente). */
export function localUnidadeSerie(u: UnidadeSerieLocal): string {
  if (u.status === "EM_ESTOQUE" && u.filial) {
    return `${u.filial.sigla} — ${u.filial.nome}`;
  }
  if (u.status === "EM_TRANSITO") {
    if (u.emTransito) {
      return `${u.emTransito.origemSigla} → ${u.emTransito.destinoSigla}`;
    }
    return "Em trânsito";
  }
  if (u.status === "SAIDO" && u.cliente) {
    return u.cliente.nome;
  }
  return "—";
}
