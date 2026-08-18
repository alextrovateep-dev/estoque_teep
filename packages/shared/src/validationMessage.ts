/** Mensagem genérica — sem chutar série, cliente, etc. */
export const MSG_VALIDACAO_GENERICA =
  "Dados inválidos. Verifique os campos e tente de novo.";

const POR_CAMPO: Record<string, string> = {
  resumoProblema: "Informe o resumo do problema.",
  observacaoTecnica: "A observação técnica está inválida.",
  descricao: "Informe a descrição.",
  tempoMinutos: "Informe o tempo em minutos (número inteiro).",
  produtoId: "Selecione o produto na lista.",
  quantidade: "Informe a quantidade (maior que zero).",
  pecas: "Revise as peças previstas: selecione o produto e a quantidade.",
  servicos: "Revise os serviços: informe a descrição e o tempo em minutos.",
  series: "Informe o número de série.",
  numeroSerie: "Informe o número de série.",
  numeroSerieBoa: "Informe o número de série da peça boa.",
  clienteId: "Selecione o cliente.",
  documento: "CNPJ é obrigatório e deve ser válido (00.000.000/0000-00).",
  responsavelComercialId: "Selecione o responsável comercial.",
  nfCobrancaNumero: "Informe o número da NF de cobrança.",
  valorCobrado: "Informe o valor cobrado (maior que zero).",
};

function mensagemInutil(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return (
    !t ||
    t === "required" ||
    t === "invalid" ||
    t === "dados inválidos" ||
    t === "invalid uuid" ||
    t.startsWith("expected ") ||
    t.includes("received") ||
    t.startsWith("invalid enum") ||
    t === "invalid_type"
  );
}

/** Traduz erro de validação (Zod) para orientação objetiva ao usuário. */
export function mensagemErroValidacao(opts: {
  message?: string;
  path?: (string | number)[];
}): string {
  const raw = (opts.message || "").trim();
  if (raw && !mensagemInutil(raw)) return raw;
  const path = opts.path || [];
  for (let i = path.length - 1; i >= 0; i--) {
    const key = path[i];
    if (typeof key === "string" && POR_CAMPO[key]) return POR_CAMPO[key];
  }
  return MSG_VALIDACAO_GENERICA;
}
