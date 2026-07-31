export const PERFIS = ["ADMIN", "GERENTE", "OPERADOR"] as const;
export type Perfil = (typeof PERFIS)[number];

/** Natureza do tipo: afeta um estoque ou move entre dois */
export const OPERACOES = ["ENTRADA", "SAIDA", "TRANSFERENCIA"] as const;
export type Operacao = (typeof OPERACOES)[number];

export const MOVIMENTACAO_STATUS = [
  "PENDENTE",
  "CONCLUIDO",
  "ESTORNADO",
  "REJEITADO",
] as const;
export type MovimentacaoStatus = (typeof MOVIMENTACAO_STATUS)[number];

export const TRANSFERENCIA_STATUS = [
  "PENDENTE_APROVACAO",
  "EM_TRANSITO",
  "CONFERINDO",
  "RECEBIDO",
  "PARCIAL",
  "CANCELADO",
  "REJEITADO",
] as const;
export type TransferenciaStatus = (typeof TRANSFERENCIA_STATUS)[number];

export const CLIENTE_TIPOS = ["CLIENTE", "FORNECEDOR", "INTERNO"] as const;
export type ClienteTipo = (typeof CLIENTE_TIPOS)[number];

export const TIPO_INVENTARIO = "Inventário / Saldo Inicial";
export const TIPO_AJUSTE_POS = "Ajuste Positivo";
export const TIPO_AJUSTE_NEG = "Ajuste Negativo";
export const TIPO_TRANSF_ENVIADA = "Transferência Enviada";
export const TIPO_TRANSF_RECEBIDA = "Transferência Recebida";
/** Tipo de lançamento unificado (F15) — pode ter requerAprovacao */
export const TIPO_TRANSF_ENTRE_ESTOQUES = "Transferência entre estoques";
export const TIPO_ESTORNO = "Estorno";

export const BRAND_COLOR = "#5B8B83";

/** Eventos de alerta por e-mail (preferências no cadastro do usuário) */
export const ALERTA_EVENTOS = [
  "ESTOQUE_MINIMO",
  "ESTOQUE_MAXIMO",
  "PRECO_AJUSTADO",
  "DIVERGENCIA_TRANSFERENCIA",
  "ALERTA_RETORNO_MOVIMENTACAO",
] as const;
export type AlertaEvento = (typeof ALERTA_EVENTOS)[number];

export const ALERTA_EVENTO_LABELS: Record<AlertaEvento, string> = {
  ESTOQUE_MINIMO: "Produto abaixo do estoque mínimo",
  ESTOQUE_MAXIMO: "Produto acima do estoque máximo",
  PRECO_AJUSTADO: "Produto teve preço ajustado",
  DIVERGENCIA_TRANSFERENCIA: "Divergência em transferência",
  ALERTA_RETORNO_MOVIMENTACAO: "Alerta de retorno (demo/comodato)",
};

export const MOVIMENTACAO_ANEXO_TIPOS = [
  "NOTA_FISCAL",
  "TERMO_COMODATO",
  "OUTRO",
] as const;
export type MovimentacaoAnexoTipo = (typeof MOVIMENTACAO_ANEXO_TIPOS)[number];

/** Status de unidade com número de série */
export const SERIE_STATUS = [
  "EM_ESTOQUE",
  "EM_TRANSITO",
  "SAIDO",
] as const;
export type SerieStatus = (typeof SERIE_STATUS)[number];

export const DIAS_ALERTA_RETORNO_DEFAULT = [15, 30, 45, 60] as const;

/**
 * Permissões de tela/ação configuráveis por usuário (além do perfil).
 * Admin ignora e tem tudo. Área /admin/* continua só ADMIN.
 */
export const PERMISSAO_KEYS = [
  "dashboard",
  "assistente",
  "lancamentos",
  "transferencias",
  "movimentacoes",
  "aprovacoes",
  "cadastros",
  "estoque_init",
] as const;
export type PermissaoKey = (typeof PERMISSAO_KEYS)[number];

export type PermissoesUsuario = Record<PermissaoKey, boolean>;

export const PERMISSAO_LABELS: Record<
  PermissaoKey,
  { label: string; descricao: string }
> = {
  dashboard: {
    label: "Dashboard / Saldos",
    descricao: "Ver saldos, KPIs e gráficos",
  },
  assistente: {
    label: "Assistente de estoque (IA)",
    descricao: "Usar o chat de IA no Dashboard (exige Dashboard)",
  },
  lancamentos: {
    label: "Novo Lançamento",
    descricao: "Criar entradas, saídas e transferências",
  },
  transferencias: {
    label: "Confirmar Recebimento",
    descricao: "Conferir e confirmar cargas em trânsito",
  },
  movimentacoes: {
    label: "Movimentações",
    descricao: "Histórico de movimentações",
  },
  aprovacoes: {
    label: "Aprovações / Estornos",
    descricao: "Aprovar, rejeitar e estornar movimentos",
  },
  cadastros: {
    label: "Cadastros",
    descricao: "Produtos, categorias e clientes",
  },
  estoque_init: {
    label: "Inventário",
    descricao: "Inventário / saldo inicial em lote",
  },
};

/** Defaults por perfil (antes dos overrides do Admin). */
export function defaultPermissoes(perfil: Perfil): PermissoesUsuario {
  if (perfil === "ADMIN") {
    return Object.fromEntries(
      PERMISSAO_KEYS.map((k) => [k, true])
    ) as PermissoesUsuario;
  }
  if (perfil === "GERENTE") {
    return {
      dashboard: true,
      assistente: true,
      lancamentos: true,
      transferencias: true,
      movimentacoes: true,
      aprovacoes: true,
      cadastros: true,
      estoque_init: true,
    };
  }
  return {
    dashboard: false,
    assistente: false,
    lancamentos: true,
    transferencias: true,
    movimentacoes: true,
    aprovacoes: false,
    cadastros: false,
    estoque_init: false,
  };
}

/** Mescla defaults do perfil com overrides salvos (só keys conhecidas). */
export function resolvePermissoes(
  perfil: Perfil,
  overrides?: Partial<Record<string, boolean>> | null
): PermissoesUsuario {
  const base = defaultPermissoes(perfil);
  if (perfil === "ADMIN") return base;
  if (!overrides || typeof overrides !== "object") return base;
  const out = { ...base };
  for (const k of PERMISSAO_KEYS) {
    if (typeof overrides[k] === "boolean") out[k] = overrides[k]!;
  }
  // Assistente sem dashboard não faz sentido
  if (out.assistente && !out.dashboard) out.assistente = false;
  // Gestão continua restrita a Gerente+ (API/services)
  if (perfil === "OPERADOR") {
    out.aprovacoes = false;
    out.cadastros = false;
    out.estoque_init = false;
  }
  return out;
}

export function hasPermissao(
  perfil: Perfil,
  permissoes: PermissoesUsuario | Partial<Record<string, boolean>> | null | undefined,
  key: PermissaoKey
): boolean {
  if (perfil === "ADMIN") return true;
  const resolved = resolvePermissoes(perfil, permissoes);
  return Boolean(resolved[key]);
}

/** 0 = limiar desligado (não gera alerta) */
export function isAbaixoMinimo(saldo: number, estoqueMinimo: number): boolean {
  return estoqueMinimo > 0 && saldo <= estoqueMinimo;
}

/** 0 = limiar desligado (não gera alerta) */
export function isAcimaMaximo(saldo: number, estoqueMaximo: number): boolean {
  return estoqueMaximo > 0 && saldo >= estoqueMaximo;
}

export function labelOperacao(op: string): string {
  if (op === "ENTRADA") return "Entrada";
  if (op === "SAIDA") return "Saída";
  if (op === "TRANSFERENCIA") return "Transferência (sai → entra)";
  return op;
}

/** Compara dia/mês da data de nascimento com o dia local de hoje. */
export function isAniversarioHoje(
  dataNascimento: string | Date | null | undefined
): boolean {
  if (!dataNascimento) return false;
  let month: number;
  let day: number;
  if (typeof dataNascimento === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataNascimento);
    if (!m) return false;
    month = Number(m[2]);
    day = Number(m[3]);
  } else {
    if (Number.isNaN(dataNascimento.getTime())) return false;
    month = dataNascimento.getUTCMonth() + 1;
    day = dataNascimento.getUTCDate();
  }
  const hoje = new Date();
  return month === hoje.getMonth() + 1 && day === hoje.getDate();
}

