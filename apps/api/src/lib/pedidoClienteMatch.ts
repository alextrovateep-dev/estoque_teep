import {
  formatCnpj,
  isValidCnpj,
  normalizeDocumento,
  onlyDigits,
  sameDocumento,
} from "@teep/shared";

export const MSG_PEDIDO_SEM_CNPJ_EGESTOR =
  "Contato do pedido sem CNPJ no eGestor — corrija o contato e clique em Atualizar do eGestor";

export const MSG_PEDIDO_CPF_NAO_ACEITO =
  "Contato do eGestor tem CPF; a separação exige CNPJ cadastrado no TEEP";

export const MSG_PEDIDO_CNPJ_INVALIDO =
  "CNPJ do contato no eGestor é inválido — corrija no eGestor e atualize o pedido";

export function mensagemPedidoCnpjSemCliente(documento: string): string {
  const label = formatCnpj(documento) || documento;
  return `Cliente com CNPJ ${label} não encontrado (ou inativo) no cadastro TEEP — cadastre o cliente para separar`;
}

/** Normaliza o CPF/CNPJ do eGestor: só grava CNPJ válido; demais casos devolvem null + motivo. */
export function interpretarDocumentoContatoEgestor(
  raw: string | null | undefined
): {
  documentoContato: string | null;
  bloqueio: string | null;
} {
  const digits = onlyDigits(raw || "");
  if (!digits) {
    return { documentoContato: null, bloqueio: MSG_PEDIDO_SEM_CNPJ_EGESTOR };
  }
  if (digits.length === 11) {
    return { documentoContato: null, bloqueio: MSG_PEDIDO_CPF_NAO_ACEITO };
  }
  if (digits.length !== 14 || !isValidCnpj(digits)) {
    return { documentoContato: null, bloqueio: MSG_PEDIDO_CNPJ_INVALIDO };
  }
  return {
    documentoContato: normalizeDocumento(digits),
    bloqueio: null,
  };
}

export function mensagemBloqueioSeparacaoCliente(opts: {
  documentoContato?: string | null;
  clienteId?: string | null;
}): string | null {
  const doc = opts.documentoContato?.trim() || null;
  if (!doc || !isValidCnpj(doc)) {
    const interp = interpretarDocumentoContatoEgestor(doc);
    return interp.bloqueio || MSG_PEDIDO_SEM_CNPJ_EGESTOR;
  }
  if (!opts.clienteId) {
    return mensagemPedidoCnpjSemCliente(doc);
  }
  return null;
}

/** Índice CNPJ (só dígitos) → id do cliente ativo. */
export function indexClientesPorCnpj(
  rows: Array<{ id: string; documento: string | null; ativo?: boolean }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.ativo === false) continue;
    const d = onlyDigits(row.documento || "");
    if (d.length === 14 && isValidCnpj(d) && !map.has(d)) {
      map.set(d, row.id);
    }
  }
  return map;
}

export function clienteIdPorDocumento(
  index: Map<string, string>,
  documento: string | null | undefined
): string | null {
  const d = onlyDigits(documento || "");
  if (!d) return null;
  return index.get(d) || null;
}

export function mesmoCnpjPedidoCliente(
  documentoContato: string | null | undefined,
  documentoCliente: string | null | undefined
): boolean {
  return sameDocumento(documentoContato, documentoCliente);
}
