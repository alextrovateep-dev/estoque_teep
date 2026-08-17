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
/** @deprecated Preferir flag `rmaEntradaEstoque` no tipo — mantido p/ seed/legado */
export const TIPO_ENTRADA_RMA = "Entrada RMA";
/** @deprecated Preferir flag `rmaSaidaCliente` no tipo — mantido p/ seed/legado */
export const TIPO_SAIDA_RMA = "Saída RMA";
/**
 * Tipo sistema: saída automática de cada componente na baixa pela árvore.
 * Nome no banco (histórico pode ter sido "Consumo Montagem" — o seed renomeia).
 */
export const TIPO_CONSUMO_MONTAGEM = "Baixa de componente (árvore)";

/** Locais de estoque especiais (Filial.sigla) */
export const SIGLA_ESTOQUE_RMA = "RMA";
export const SIGLA_ESTOQUE_DESCARTE = "DESC";

export const RMA_PROCESSO_STATUS = ["ABERTO", "FECHADO", "CANCELADO"] as const;
export type RmaProcessoStatus = (typeof RMA_PROCESSO_STATUS)[number];

export const RMA_ITEM_STATUS = [
  "ABERTO",
  "EM_ESTOQUE",
  "SEM_MANUTENCAO",
  "DEVOLVIDO",
  "DESCARTADO",
  "CANCELADO",
] as const;
export type RmaItemStatus = (typeof RMA_ITEM_STATUS)[number];

export const RMA_ANEXO_TIPOS = [
  "LAUDO",
  "NF_ENTRADA",
  "NF_SAIDA",
  "NF_COBRANCA",
  "OUTRO",
] as const;
export type RmaAnexoTipo = (typeof RMA_ANEXO_TIPOS)[number];

/** Workflow comercial/operacional por item (nota = processo; manutenção = item) */
export const RMA_ITEM_ETAPA = [
  "AGUARDANDO_RECEBIMENTO",
  "AGUARDANDO_ORCAMENTO",
  "AGUARDANDO_APROVACAO",
  "AGUARDANDO_MANUTENCAO",
  "AGUARDANDO_LIBERACAO",
  "NAO_APROVADO",
  "AGUARDANDO_ENVIO",
  "FINALIZADO",
  /** @deprecated legado — migrado para AGUARDANDO_RECEBIMENTO */
  "AGUARDANDO_LAUDO",
] as const;
export type RmaItemEtapa = (typeof RMA_ITEM_ETAPA)[number];

export const RMA_ITEM_ETAPA_LABELS: Record<RmaItemEtapa, string> = {
  AGUARDANDO_RECEBIMENTO: "Aguardando recebimento",
  AGUARDANDO_ORCAMENTO: "Aguardando orçamento",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  AGUARDANDO_MANUTENCAO: "Aguardando manutenção",
  AGUARDANDO_LIBERACAO: "Aguardando liberação",
  NAO_APROVADO: "Não aprovado",
  AGUARDANDO_ENVIO: "Aguardando envio",
  FINALIZADO: "Finalizado",
  AGUARDANDO_LAUDO: "Aguardando recebimento",
};

/** Etapas em que Devolver/Trocar são permitidos */
export const RMA_ITEM_ETAPAS_SAIDA = [
  "AGUARDANDO_ENVIO",
  "NAO_APROVADO",
] as const;

/** Recebimento ativo (inclui legado AGUARDANDO_LAUDO). */
export function rmaEtapaEmRecebimento(etapa: string | null | undefined): boolean {
  return (
    etapa === "AGUARDANDO_RECEBIMENTO" || etapa === "AGUARDANDO_LAUDO"
  );
}

export const MSG_CHECKLIST_RECEBIMENTO_PENDENTE =
  "Conclua o checklist de recebimento antes de concluir o diagnóstico";

/**
 * Exige checklist de entrada se o produto tem template ou a execução já começou.
 * `temTemplateRecebimento: null` = ainda não sabemos (bloqueia, para não liberar cedo).
 */
export function mensagemBloqueioDiagnostico(opts: {
  execucaoRecebimento?: { status: string } | null;
  temTemplateRecebimento: boolean | null;
}): string | null {
  if (opts.execucaoRecebimento) {
    return opts.execucaoRecebimento.status === "CONCLUIDO"
      ? null
      : MSG_CHECKLIST_RECEBIMENTO_PENDENTE;
  }
  return opts.temTemplateRecebimento === false
    ? null
    : MSG_CHECKLIST_RECEBIMENTO_PENDENTE;
}

export const RMA_CHECKLIST_TIPOS = ["RECEBIMENTO", "LIBERACAO"] as const;
export type RmaChecklistTipo = (typeof RMA_CHECKLIST_TIPOS)[number];

export const RMA_CHECKLIST_CAMPO_TIPOS = [
  "SIM_NAO",
  "TEXTO",
  "OPCAO",
  "FOTO",
] as const;
export type RmaChecklistCampoTipo = (typeof RMA_CHECKLIST_CAMPO_TIPOS)[number];

export const RMA_CHECKLIST_EXEC_STATUS = [
  "EM_PREENCHIMENTO",
  "CONCLUIDO",
] as const;
export type RmaChecklistExecStatus = (typeof RMA_CHECKLIST_EXEC_STATUS)[number];

export const RMA_ORCAMENTO_STATUS = [
  "RASCUNHO",
  "ENVIADO",
  "APROVADO",
  "RECUSADO",
] as const;
export type RmaOrcamentoStatus = (typeof RMA_ORCAMENTO_STATUS)[number];

/** ENVIADO no banco = pronto para PDF e negociação com o cliente (valores ainda editáveis). */
export const RMA_ORCAMENTO_STATUS_LABELS: Record<RmaOrcamentoStatus, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Em negociação",
  APROVADO: "Aprovado",
  RECUSADO: "Recusado",
};

export function rmaOrcamentoStatusLabel(
  status: string | null | undefined
): string {
  if (!status) return "Sem orçamento";
  return (
    (RMA_ORCAMENTO_STATUS_LABELS as Record<string, string>)[status] || status
  );
}

/** Rascunho ou em negociação (fechado, ainda sem aprovar/recusar). */
export function rmaOrcamentoPodeEditar(opts: {
  etapa: string;
  orcamentoStatus?: string | null;
}): boolean {
  const st = opts.orcamentoStatus;
  if (opts.etapa === "AGUARDANDO_ORCAMENTO" && (!st || st === "RASCUNHO")) {
    return true;
  }
  return opts.etapa === "AGUARDANDO_APROVACAO" && st === "ENVIADO";
}

/**
 * Reabrir só com orçamento fechado (ENVIADO) na etapa de aprovação.
 * Depois de aprovado/recusado não volta a rascunho.
 */
export function mensagemBloqueioReabrirOrcamento(opts: {
  orcamentoStatus?: string | null;
  etapa: string;
}): string | null {
  if (opts.orcamentoStatus === "APROVADO") {
    return "Orçamento já foi aprovado — não é possível reabrir";
  }
  if (opts.orcamentoStatus === "RECUSADO") {
    return "Orçamento já foi recusado — não é possível reabrir";
  }
  if (
    opts.orcamentoStatus !== "ENVIADO" ||
    opts.etapa !== "AGUARDANDO_APROVACAO"
  ) {
    return "Só é possível reabrir orçamento fechado aguardando aprovação";
  }
  return null;
}

export const BRAND_COLOR = "#5B8B83";

/** Eventos de alerta (preferências no cadastro: sino; e-mail via master + allowlist) */
export const ALERTA_EVENTOS = [
  "ESTOQUE_MINIMO",
  "ESTOQUE_MAXIMO",
  "PRECO_AJUSTADO",
  "DIVERGENCIA_TRANSFERENCIA",
  "ALERTA_RETORNO_MOVIMENTACAO",
  "TRANSFERENCIA_PENDENTE_APROVACAO",
  "TRANSFERENCIA_APROVADA",
  "TRANSFERENCIA_REJEITADA",
  "RMA_ABERTO",
  "RMA_FINANCEIRO",
  "RMA_ENCERRADO",
  "RMA_LAUDO",
] as const;
export type AlertaEvento = (typeof ALERTA_EVENTOS)[number];

export const ALERTA_EVENTO_LABELS: Record<AlertaEvento, string> = {
  ESTOQUE_MINIMO: "Produto abaixo do estoque mínimo",
  ESTOQUE_MAXIMO: "Produto acima do estoque máximo",
  PRECO_AJUSTADO: "Produto teve preço ajustado",
  DIVERGENCIA_TRANSFERENCIA: "Divergência em transferência",
  ALERTA_RETORNO_MOVIMENTACAO: "Alerta de retorno (demo/comodato)",
  TRANSFERENCIA_PENDENTE_APROVACAO: "Transferência pendente de aprovação",
  TRANSFERENCIA_APROVADA: "Transferência aprovada",
  TRANSFERENCIA_REJEITADA: "Transferência rejeitada",
  RMA_ABERTO: "RMA aberto",
  RMA_FINANCEIRO: "RMA — atualização financeira",
  RMA_ENCERRADO: "RMA encerrado (fechado ou cancelado)",
  RMA_LAUDO: "RMA — laudo(s) anexado(s)",
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
 *
 * Cadastros: permissão por página (consultar e cadastrar/editar separados).
 */
export const PERMISSAO_KEYS = [
  "dashboard",
  "assistente",
  "lancamentos",
  "transferencias",
  "movimentacoes",
  "aprovacoes",
  "cadastros_produtos_ver",
  "cadastros_produtos_editar",
  "cadastros_clientes_ver",
  "cadastros_clientes_editar",
  "cadastros_arvore_ver",
  "cadastros_arvore_editar",
  "estoque_init",
  "rma",
  "rma_cobranca",
  "relatorios",
] as const;
export type PermissaoKey = (typeof PERMISSAO_KEYS)[number];

export type PermissoesUsuario = Record<PermissaoKey, boolean>;

/** Páginas de cadastro (moderação por tela). */
export const CADASTROS_PAGINAS = [
  {
    id: "produtos",
    label: "Produtos",
    href: "/cadastros/produtos",
    ver: "cadastros_produtos_ver",
    editar: "cadastros_produtos_editar",
  },
  {
    id: "clientes",
    label: "Clientes / Fornecedores",
    href: "/cadastros/clientes",
    ver: "cadastros_clientes_ver",
    editar: "cadastros_clientes_editar",
  },
  {
    id: "arvore",
    label: "Árvore de produto",
    href: "/cadastros/arvore",
    ver: "cadastros_arvore_ver",
    editar: "cadastros_arvore_editar",
  },
] as const;

export type CadastrosPaginaId = (typeof CADASTROS_PAGINAS)[number]["id"];

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
    label: "Transferências",
    descricao: "Acompanhar cargas e confirmar recebimento",
  },
  movimentacoes: {
    label: "Movimentações",
    descricao: "Histórico de movimentações",
  },
  aprovacoes: {
    label: "Aprovações / Estornos",
    descricao: "Aprovar, rejeitar e estornar movimentos",
  },
  cadastros_produtos_ver: {
    label: "Produtos — consultar",
    descricao: "Abrir a página de produtos",
  },
  cadastros_produtos_editar: {
    label: "Produtos — cadastrar/editar",
    descricao: "Criar e alterar produtos",
  },
  cadastros_clientes_ver: {
    label: "Clientes — consultar",
    descricao: "Abrir a página de clientes/fornecedores",
  },
  cadastros_clientes_editar: {
    label: "Clientes — cadastrar/editar",
    descricao: "Criar e alterar clientes/fornecedores",
  },
  cadastros_arvore_ver: {
    label: "Árvore — consultar",
    descricao: "Abrir a página de árvore de produto",
  },
  cadastros_arvore_editar: {
    label: "Árvore — cadastrar/editar",
    descricao: "Criar e alterar a montagem (BOM)",
  },
  estoque_init: {
    label: "Inventário",
    descricao: "Inventário / saldo inicial em lote",
  },
  rma: {
    label: "RMA",
    descricao: "Abrir e operar processos RMA (itens, laudos, devolução/troca)",
  },
  rma_cobranca: {
    label: "RMA — cobrança",
    descricao:
      "Informar cobrança por item (valor/NF) e anexar NF de cobrança — também após o RMA fechado",
  },
  relatorios: {
    label: "Relatórios",
    descricao: "Hub de relatórios (produtos, estoque, árvore) e exportações",
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
      cadastros_produtos_ver: true,
      cadastros_produtos_editar: true,
      cadastros_clientes_ver: true,
      cadastros_clientes_editar: true,
      cadastros_arvore_ver: true,
      cadastros_arvore_editar: true,
      estoque_init: true,
      rma: true,
      rma_cobranca: true,
      relatorios: true,
    };
  }
  return {
    dashboard: false,
    assistente: false,
    lancamentos: true,
    transferencias: true,
    movimentacoes: true,
    aprovacoes: false,
    cadastros_produtos_ver: false,
    cadastros_produtos_editar: false,
    cadastros_clientes_ver: false,
    cadastros_clientes_editar: false,
    cadastros_arvore_ver: false,
    cadastros_arvore_editar: false,
    estoque_init: false,
    rma: true,
    rma_cobranca: false,
    relatorios: false,
  };
}

function applyCadastrosCompat(
  out: PermissoesUsuario,
  overrides: Partial<Record<string, boolean>>
) {
  if (overrides.cadastros === true) {
    for (const p of CADASTROS_PAGINAS) {
      if (typeof overrides[p.ver] !== "boolean") out[p.ver] = true;
    }
  } else if (overrides.cadastros === false) {
    for (const p of CADASTROS_PAGINAS) {
      if (typeof overrides[p.ver] !== "boolean") out[p.ver] = false;
      if (typeof overrides[p.editar] !== "boolean") out[p.editar] = false;
    }
  }
  if (overrides.cadastros_editar === true) {
    for (const p of CADASTROS_PAGINAS) {
      if (typeof overrides[p.editar] !== "boolean") out[p.editar] = true;
      if (typeof overrides[p.ver] !== "boolean") out[p.ver] = true;
    }
  }
  const legadoEdit: Array<[string, (typeof CADASTROS_PAGINAS)[number]]> = [
    ["cadastros_produtos", CADASTROS_PAGINAS[0]],
    ["cadastros_clientes", CADASTROS_PAGINAS[1]],
    ["cadastros_arvore", CADASTROS_PAGINAS[2]],
  ];
  for (const [oldKey, pagina] of legadoEdit) {
    if (overrides[oldKey] === true) {
      if (typeof overrides[pagina.editar] !== "boolean") out[pagina.editar] = true;
      if (typeof overrides[pagina.ver] !== "boolean") out[pagina.ver] = true;
    } else if (overrides[oldKey] === false) {
      if (typeof overrides[pagina.editar] !== "boolean") out[pagina.editar] = false;
    }
  }
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
  applyCadastrosCompat(out, overrides);
  if (out.assistente && !out.dashboard) out.assistente = false;
  for (const p of CADASTROS_PAGINAS) {
    if (out[p.editar] && !out[p.ver]) out[p.ver] = true;
  }
  if (perfil === "OPERADOR") {
    out.aprovacoes = false;
    for (const p of CADASTROS_PAGINAS) {
      out[p.ver] = false;
      out[p.editar] = false;
    }
    out.estoque_init = false;
    out.rma_cobranca = false;
  }
  return out;
}

/** Tem acesso à página (consultar ou editar). */
export function hasCadastroPagina(
  permissoes: PermissoesUsuario,
  paginaId: CadastrosPaginaId
): boolean {
  const p = CADASTROS_PAGINAS.find((x) => x.id === paginaId);
  if (!p) return false;
  return Boolean(permissoes[p.ver] || permissoes[p.editar]);
}

/** Pode cadastrar/editar na página. */
export function hasCadastroEditar(
  permissoes: PermissoesUsuario,
  paginaId: CadastrosPaginaId
): boolean {
  const p = CADASTROS_PAGINAS.find((x) => x.id === paginaId);
  if (!p) return false;
  return Boolean(permissoes[p.editar]);
}

/** Alguma página de cadastro liberada. */
export function hasQualquerCadastro(permissoes: PermissoesUsuario): boolean {
  return CADASTROS_PAGINAS.some(
    (p) => permissoes[p.ver] || permissoes[p.editar]
  );
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

