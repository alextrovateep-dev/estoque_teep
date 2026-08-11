import { AppError } from "../middleware/error";
import { formatCep, onlyDigits } from "@teep/shared";

export type CepLookupResult = {
  cep: string;
  logradouro: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  complemento: string | null;
};

const LOOKUP_TIMEOUT_MS = 6_000;

async function fetchJson(
  url: string
): Promise<{ ok: boolean; status: number; json: unknown }> {
  // Validação SSRF: apenas URLs HTTPS para domínios conhecidos
  // URLs são construídas internamente, não vêm do usuário
  const allowedDomains = [
    'https://viacep.com.br',
    'https://brasilapi.com.br',
    'https://publica.cnpj.ws'
  ];
  
  if (!url.startsWith('https://')) {
    throw new Error('URL inválida para fetch: deve ser HTTPS');
  }
  
  // Verifica se a URL começa com um dos domínios permitidos
  const isAllowed = allowedDomains.some(domain => url.startsWith(domain));
  if (!isAllowed) {
    throw new Error(`URL não permitida para fetch: ${url}`);
  }
  
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

/**
 * CEP: ViaCEP primeiro, BrasilAPI como fallback.
 */
export async function lookupCep(cepRaw: string): Promise<CepLookupResult> {
  const digits = onlyDigits(cepRaw).slice(0, 8);
  if (digits.length !== 8 || /^0+$/.test(digits)) {
    throw new AppError(400, "CEP deve ter 8 dígitos");
  }

  const formatted = formatCep(digits)!;

  // 1) ViaCEP
  try {
    const { ok, json } = await fetchJson(
      `https://viacep.com.br/ws/${digits}/json/`
    );
    if (ok && json && typeof json === "object") {
      const parsed = json as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
        complemento?: string;
      };
      if (!parsed.erro) {
        return {
          cep: formatted,
          logradouro: (parsed.logradouro || "").trim().slice(0, 120) || null,
          bairro: (parsed.bairro || "").trim().slice(0, 80) || null,
          cidade: (parsed.localidade || "").trim().slice(0, 50) || null,
          estado: (parsed.uf || "").trim().toUpperCase().slice(0, 2) || null,
          complemento: (parsed.complemento || "").trim().slice(0, 80) || null,
        };
      }
    }
  } catch {
    /* fallback */
  }

  // 2) BrasilAPI
  try {
    const { ok, status, json } = await fetchJson(
      `https://brasilapi.com.br/api/cep/v1/${digits}`
    );
    if (status === 404) {
      throw new AppError(404, "CEP não encontrado");
    }
    if (ok && json && typeof json === "object") {
      const parsed = json as {
        street?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
      };
      return {
        cep: formatted,
        logradouro: (parsed.street || "").trim().slice(0, 120) || null,
        bairro: (parsed.neighborhood || "").trim().slice(0, 80) || null,
        cidade: (parsed.city || "").trim().slice(0, 50) || null,
        estado: (parsed.state || "").trim().toUpperCase().slice(0, 2) || null,
        complemento: null,
      };
    }
  } catch (e) {
    if (e instanceof AppError && e.status === 404) throw e;
  }

  throw new AppError(
    502,
    "Consulta CEP indisponível — preencha o endereço manualmente"
  );
}
