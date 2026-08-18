import { normalizarGatilhoFotoChecklist } from "@teep/shared";

export type ProdutoOpt = {
  id: string;
  codigo: string;
  descricao: string;
  ativo?: boolean;
};

export type ItemDraft = {
  titulo: string;
  tipoCampo: "SIM_NAO" | "TEXTO" | "OPCAO" | "FOTO";
  obrigatorio: boolean;
  opcoesText: string;
  ajuda: string;
  exigeFotoSe: string;
};

export type ChecklistTemplate = {
  id: string;
  tipo: "RECEBIMENTO" | "LIBERACAO" | string;
  nome: string;
  ativo: boolean;
  versao: number;
  produto: ProdutoOpt;
  itens: Array<{
    codigo: string;
    titulo: string;
    ajuda?: string | null;
    tipoCampo: string;
    obrigatorio: boolean;
    ordem: number;
    opcoesJson?: string[] | null;
    exigeFotoSe?: string | null;
  }>;
};

export const TIPO_LABEL: Record<"RECEBIMENTO" | "LIBERACAO", string> = {
  RECEBIMENTO: "Recebimento",
  LIBERACAO: "Liberação",
};

export const TIPO_HINT: Record<"RECEBIMENTO" | "LIBERACAO", string> = {
  RECEBIMENTO: "Na entrada do equipamento no RMA",
  LIBERACAO: "Antes de devolver ou trocar",
};

export function emptyChecklistItem(): ItemDraft {
  return {
    titulo: "",
    tipoCampo: "SIM_NAO",
    obrigatorio: true,
    opcoesText: "",
    ajuda: "",
    exigeFotoSe: "",
  };
}

export function itemsFromTemplate(t: ChecklistTemplate): ItemDraft[] {
  return t.itens
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((it) => ({
      titulo: it.titulo,
      tipoCampo: (it.tipoCampo as ItemDraft["tipoCampo"]) || "SIM_NAO",
      obrigatorio: it.obrigatorio !== false,
      opcoesText: Array.isArray(it.opcoesJson) ? it.opcoesJson.join(", ") : "",
      ajuda: it.ajuda || "",
      exigeFotoSe: it.exigeFotoSe || "",
    }));
}

export function parseChecklistTipo(
  raw: string
): "RECEBIMENTO" | "LIBERACAO" | null {
  const t = String(raw || "").toUpperCase();
  if (t === "RECEBIMENTO" || t === "LIBERACAO") return t;
  return null;
}

/** Valor do seletor de foto condicional (Sim / Não). */
export function exigeFotoSeSelectValue(raw: string): "" | "SIM" | "NAO" {
  const t = normalizarGatilhoFotoChecklist(raw);
  if (t === "SIM" || t === "NAO") return t;
  return "";
}
