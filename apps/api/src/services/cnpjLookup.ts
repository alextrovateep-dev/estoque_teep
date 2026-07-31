import { AppError } from "../middleware/error";
import { formatCep, formatCnpj, onlyDigits } from "@teep/shared";

export type CnpjLookupResult = {
  cnpj: string;
  documento: string;
  nome: string;
  nomeFantasia: string | null;
  email: string | null;
  telefone: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
};

const LOOKUP_TIMEOUT_MS = 6_000;

function formatTelefone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = onlyDigits(raw);
  if (!d) return null;
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  return raw.trim().slice(0, 20) || null;
}

async function fetchJson(
  url: string
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

/** Resposta típica de publica.cnpj.ws */
type CnpjWsPayload = {
  razao_social?: string;
  nome_fantasia?: string;
  cnpj?: string;
  email?: string;
  estabelecimento?: {
    nome_fantasia?: string;
    email?: string;
    telefone1?: string;
    telefone2?: string;
    ddd1?: string;
    ddd2?: string;
    cep?: string;
    logradouro?: string;
    tipo_logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: { nome?: string } | string;
    estado?: { sigla?: string } | string;
    endereco?: {
      cep?: string;
      logradouro?: string;
      tipo_logradouro?: string;
      numero?: string;
      complemento?: string;
      bairro?: string;
      cidade?: { nome?: string } | string;
      estado?: { sigla?: string } | string;
      municipio?: string;
      uf?: string;
    };
  };
};

function cidadeNome(v: { nome?: string } | string | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v.nome || "";
}

function estadoSigla(v: { sigla?: string } | string | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v.sigla || "";
}

function mapFromCnpjWs(digits: string, data: CnpjWsPayload): CnpjLookupResult | null {
  const est = data.estabelecimento || {};
  const end = est.endereco || {};
  const nome = (data.razao_social || "").trim();
  if (!nome) return null;

  const fantasia = (
    est.nome_fantasia ||
    data.nome_fantasia ||
    ""
  ).trim();
  const emailRaw = (est.email || data.email || "").trim().toLowerCase();

  let telefoneRaw = est.telefone1 || est.telefone2 || "";
  if (!telefoneRaw && est.ddd1) {
    telefoneRaw = `${est.ddd1}${est.telefone1 || ""}`;
  }

  const logradouro =
    end.logradouro ||
    est.logradouro ||
    [end.tipo_logradouro || est.tipo_logradouro, end.logradouro || est.logradouro]
      .filter(Boolean)
      .join(" ") ||
    "";
  const numeroRaw = end.numero || est.numero || "";
  const numero =
    numeroRaw && String(numeroRaw).toUpperCase() !== "S/N"
      ? String(numeroRaw).trim()
      : "";
  const cepRaw = end.cep || est.cep || "";
  const cidade =
    cidadeNome(end.cidade) ||
    cidadeNome(est.cidade) ||
    (end as { municipio?: string }).municipio ||
    "";
  const uf =
    estadoSigla(end.estado) ||
    estadoSigla(est.estado) ||
    (end as { uf?: string }).uf ||
    "";

  return {
    cnpj: digits,
    documento: formatCnpj(digits),
    nome: nome.slice(0, 150),
    nomeFantasia: fantasia ? fantasia.slice(0, 120) : null,
    email: emailRaw.includes("@") ? emailRaw.slice(0, 100) : null,
    telefone: formatTelefone(telefoneRaw),
    cep: formatCep(cepRaw),
    logradouro: logradouro.trim().slice(0, 120) || null,
    numero: numero.slice(0, 20) || null,
    complemento: (end.complemento || est.complemento || "")
      .trim()
      .slice(0, 80) || null,
    bairro: (end.bairro || est.bairro || "").trim().slice(0, 80) || null,
    cidade: cidade.trim().slice(0, 50) || null,
    estado: uf.trim().toUpperCase().slice(0, 2) || null,
  };
}

type BrasilApiCnpj = {
  razao_social?: string;
  nome_fantasia?: string;
  email?: string | null;
  ddd_telefone_1?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
};

function mapFromBrasilApi(digits: string, data: BrasilApiCnpj): CnpjLookupResult | null {
  const nome = (data.razao_social || "").trim();
  if (!nome) return null;
  const fantasia = (data.nome_fantasia || "").trim();
  const email = (data.email || "").trim().toLowerCase() || null;
  const uf = (data.uf || "").trim().toUpperCase().slice(0, 2) || null;
  return {
    cnpj: digits,
    documento: formatCnpj(digits),
    nome: nome.slice(0, 150),
    nomeFantasia: fantasia ? fantasia.slice(0, 120) : null,
    email: email && email.includes("@") ? email.slice(0, 100) : null,
    telefone: formatTelefone(data.ddd_telefone_1),
    cep: formatCep(data.cep || ""),
    logradouro: (data.logradouro || "").trim().slice(0, 120) || null,
    numero: (data.numero || "").trim().slice(0, 20) || null,
    complemento: (data.complemento || "").trim().slice(0, 80) || null,
    bairro: (data.bairro || "").trim().slice(0, 80) || null,
    cidade: (data.municipio || "").trim().slice(0, 50) || null,
    estado: uf,
  };
}

/**
 * Consulta CNPJ: publica.cnpj.ws (padrão ChamadoPro), fallback BrasilAPI.
 */
export async function lookupCnpj(cnpjRaw: string): Promise<CnpjLookupResult> {
  const digits = onlyDigits(cnpjRaw);
  if (digits.length !== 14) {
    throw new AppError(400, "CNPJ deve ter 14 dígitos");
  }

  // 1) CNPJ.ws pública
  try {
    const { ok, status, json } = await fetchJson(
      `https://publica.cnpj.ws/cnpj/${digits}`
    );
    if (status === 404) {
      throw new AppError(404, "CNPJ não encontrado");
    }
    if (ok && json && typeof json === "object") {
      const mapped = mapFromCnpjWs(digits, json as CnpjWsPayload);
      if (mapped) return mapped;
    }
  } catch (e) {
    if (e instanceof AppError && e.status === 404) throw e;
    /* fallback */
  }

  // 2) BrasilAPI
  try {
    const { ok, status, json } = await fetchJson(
      `https://brasilapi.com.br/api/cnpj/v1/${digits}`
    );
    if (status === 404) {
      throw new AppError(404, "CNPJ não encontrado");
    }
    if (ok && json && typeof json === "object") {
      const mapped = mapFromBrasilApi(digits, json as BrasilApiCnpj);
      if (mapped) return mapped;
    }
  } catch (e) {
    if (e instanceof AppError && e.status === 404) throw e;
  }

  throw new AppError(
    502,
    "Consulta CNPJ indisponível — preencha os dados manualmente"
  );
}
