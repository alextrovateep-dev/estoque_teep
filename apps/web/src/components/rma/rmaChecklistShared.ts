import {
  RMA_CHECKLIST_AJUDA_LACRE,
  RMA_CHECKLIST_TITULO_LACRE,
  ensureChecklistLacrePrimeiro,
  isChecklistItemLacreGarantia,
  normalizarGatilhoFotoChecklist,
} from "@teep/shared";

export type ProdutoOpt = {
  id: string;
  codigo: string;
  descricao: string;
  ativo?: boolean;
};

export type ItemDraft = {
  titulo: string;
  tipoCampo: "SIM_NAO" | "TEXTO" | "OPCAO" | "FOTO" | "LACRE_GARANTIA";
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
  RECEBIMENTO: "Inspeção",
  LIBERACAO: "Liberação",
};

export const TIPO_HINT: Record<"RECEBIMENTO" | "LIBERACAO", string> = {
  RECEBIMENTO:
    "Inspeção técnica após a chegada (o estoque RMA já foi lançado na abertura)",
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

export function lacreGarantiaChecklistItem(): ItemDraft {
  return {
    titulo: RMA_CHECKLIST_TITULO_LACRE,
    tipoCampo: "LACRE_GARANTIA",
    obrigatorio: true,
    opcoesText: "",
    ajuda: RMA_CHECKLIST_AJUDA_LACRE,
    exigeFotoSe: "",
  };
}

/** Itens iniciais ao criar checklist (inspeção já vem com lacre). */
export function defaultChecklistItens(
  tipo: "RECEBIMENTO" | "LIBERACAO"
): ItemDraft[] {
  if (tipo === "RECEBIMENTO") {
    return [lacreGarantiaChecklistItem()];
  }
  return [emptyChecklistItem()];
}

export function itemsFromTemplate(t: ChecklistTemplate): ItemDraft[] {
  const mapped = t.itens
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((it) => ({
      titulo: it.titulo,
      tipoCampo: (it.tipoCampo as ItemDraft["tipoCampo"]) || "SIM_NAO",
      obrigatorio: it.obrigatorio !== false,
      opcoesText: Array.isArray(it.opcoesJson) ? it.opcoesJson.join(", ") : "",
      ajuda: it.ajuda || "",
      exigeFotoSe: it.exigeFotoSe || "",
      codigo: it.codigo,
    }));
  if (t.tipo !== "RECEBIMENTO") {
    return mapped.map(({ codigo: _c, ...rest }) => rest);
  }
  return ensureChecklistLacrePrimeiro(mapped, {
    ...lacreGarantiaChecklistItem(),
    codigo: "LACRE",
  }).map(({ codigo: _c, ...rest }) => rest);
}

export function normalizeChecklistItensForTipo(
  tipo: "RECEBIMENTO" | "LIBERACAO",
  itens: ItemDraft[]
): ItemDraft[] {
  if (tipo !== "RECEBIMENTO") return itens;
  return ensureChecklistLacrePrimeiro(
    itens.map((it) => ({
      ...it,
      codigo: isChecklistItemLacreGarantia(it) ? "LACRE" : undefined,
    })),
    { ...lacreGarantiaChecklistItem(), codigo: "LACRE" }
  ).map(({ codigo: _c, ...rest }) => rest);
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
