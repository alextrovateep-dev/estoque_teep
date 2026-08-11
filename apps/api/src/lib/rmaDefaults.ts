import { SIGLA_ESTOQUE_DESCARTE, SIGLA_ESTOQUE_RMA } from "@teep/shared";
import { prisma } from "./prisma";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RmaFilialRef = { id: string; sigla: string; nome: string };

export type RmaDefaults = {
  filialPreparacaoId: string | null;
  filialPreparacao: RmaFilialRef | null;
  filialDescarteId: string | null;
  filialDescarte: RmaFilialRef | null;
  filiaisOrigemTrocaIds: string[];
  filiaisOrigemTroca: RmaFilialRef[];
  /** Como cada default foi resolvido (útil na UI/admin). */
  fonte: {
    preparacao: "env" | "sigla" | "none";
    descarte: "env" | "sigla" | "none";
    origemTroca: "env" | "todas_operacionais" | "none";
  };
  /** Env preenchido mas ignorado (UUID inválido / filial inativa). */
  avisos: string[];
};

export function parseUuidList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const id = part.trim();
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function asRef(f: {
  id: string;
  sigla: string;
  nome: string;
}): RmaFilialRef {
  return { id: f.id, sigla: f.sigla, nome: f.nome };
}

/**
 * Defaults leves da instalação (Fase D).
 * Env opcional; se ausente, cai na sigla RMA/DESC e estoques operacionais.
 */
export async function resolveRmaDefaults(): Promise<RmaDefaults> {
  const envPrep = process.env.RMA_FILIAL_PREPARACAO_ID?.trim() || "";
  const envDesc = process.env.RMA_FILIAL_DESCARTE_ID?.trim() || "";
  const envOrigemRaw = process.env.RMA_FILIAIS_ORIGEM_TROCA_IDS?.trim() || "";
  const envOrigemIds = parseUuidList(process.env.RMA_FILIAIS_ORIGEM_TROCA_IDS);
  const avisos: string[] = [];

  const ativas = await prisma.filial.findMany({
    where: { ativo: true },
    select: { id: true, sigla: true, nome: true },
    orderBy: { sigla: "asc" },
  });
  const byId = new Map(ativas.map((f) => [f.id, f]));
  const bySigla = new Map(ativas.map((f) => [f.sigla.toUpperCase(), f]));

  let filialPreparacao: RmaFilialRef | null = null;
  let fontePrep: RmaDefaults["fonte"]["preparacao"] = "none";
  if (envPrep && UUID_RE.test(envPrep) && byId.has(envPrep)) {
    filialPreparacao = asRef(byId.get(envPrep)!);
    fontePrep = "env";
  } else {
    if (envPrep) {
      avisos.push(
        "RMA_FILIAL_PREPARACAO_ID inválido ou filial inativa — usando sigla RMA (se existir)"
      );
    }
    const byS = bySigla.get(SIGLA_ESTOQUE_RMA);
    if (byS) {
      filialPreparacao = asRef(byS);
      fontePrep = "sigla";
    }
  }

  let filialDescarte: RmaFilialRef | null = null;
  let fonteDesc: RmaDefaults["fonte"]["descarte"] = "none";
  if (envDesc && UUID_RE.test(envDesc) && byId.has(envDesc)) {
    filialDescarte = asRef(byId.get(envDesc)!);
    fonteDesc = "env";
  } else {
    if (envDesc) {
      avisos.push(
        "RMA_FILIAL_DESCARTE_ID inválido ou filial inativa — usando sigla DESC (se existir)"
      );
    }
    const byS = bySigla.get(SIGLA_ESTOQUE_DESCARTE);
    if (byS) {
      filialDescarte = asRef(byS);
      fonteDesc = "sigla";
    }
  }

  const excluir = new Set<string>();
  if (filialPreparacao) excluir.add(filialPreparacao.id);
  if (filialDescarte) excluir.add(filialDescarte.id);

  let filiaisOrigemTroca: RmaFilialRef[] = [];
  let fonteOrigem: RmaDefaults["fonte"]["origemTroca"] = "none";
  if (envOrigemRaw) {
    filiaisOrigemTroca = envOrigemIds
      .map((id) => byId.get(id))
      .filter((f): f is NonNullable<typeof f> => Boolean(f))
      .filter((f) => !excluir.has(f.id))
      .map(asRef);
    if (filiaisOrigemTroca.length) {
      fonteOrigem = "env";
    } else {
      avisos.push(
        "RMA_FILIAIS_ORIGEM_TROCA_IDS sem filiais ativas válidas — listando estoques operacionais"
      );
      filiaisOrigemTroca = ativas
        .filter((f) => !excluir.has(f.id))
        .map(asRef);
      fonteOrigem = filiaisOrigemTroca.length ? "todas_operacionais" : "none";
    }
  } else {
    filiaisOrigemTroca = ativas
      .filter((f) => !excluir.has(f.id))
      .map(asRef);
    fonteOrigem = filiaisOrigemTroca.length ? "todas_operacionais" : "none";
  }

  return {
    filialPreparacaoId: filialPreparacao?.id ?? null,
    filialPreparacao,
    filialDescarteId: filialDescarte?.id ?? null,
    filialDescarte,
    filiaisOrigemTrocaIds: filiaisOrigemTroca.map((f) => f.id),
    filiaisOrigemTroca,
    fonte: {
      preparacao: fontePrep,
      descarte: fonteDesc,
      origemTroca: fonteOrigem,
    },
    avisos,
  };
}
