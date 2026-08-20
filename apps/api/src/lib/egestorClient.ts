import { AppError } from "../middleware/error";
import {
  EGESTOR_SITUACAO_ORCAMENTO,
  EGESTOR_SYNC_DESDE_PADRAO,
  type EgestorVendaProduto,
  type EgestorVendaSummary,
} from "./egestorPedidoRules";
import { esperaRateLimitMs } from "./egestorRateLimit";

const DEFAULT_BASE = "https://v4.egestor.com.br/api";
const MIN_GAP_MS = 1100;
const MAX_429 = 8;

let gate: Promise<void> = Promise.resolve();

function withEgestorGate<T>(fn: () => Promise<T>): Promise<T> {
  const run = gate.then(fn, fn);
  gate = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

type TokenCache = {
  access: string;
  refresh: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;
let lastCallAt = 0;

function baseUrl(): string {
  return (process.env.EGESTOR_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

function personalToken(): string {
  return (process.env.EGESTOR_PERSONAL_TOKEN || "").trim();
}

export function egestorConfigured(): boolean {
  return Boolean(personalToken());
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const wait = MIN_GAP_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`eGestor: resposta inválida (${res.status})`);
  }
}

async function fetchEgestor(
  path: string,
  init: RequestInit
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_429; attempt++) {
    await throttle();
    const res = await fetch(`${baseUrl()}${path}`, init);
    if (res.status !== 429) return res;
    const wait = esperaRateLimitMs(
      res.headers.get("Retry-After"),
      res.headers.get("X-RateLimit-Remaining"),
      attempt
    );
    await res.arrayBuffer();
    console.warn(
      `[egestor] HTTP 429 em ${path} — espera ${wait}ms (tentativa ${attempt + 1})`
    );
    if (attempt === MAX_429) break;
    await sleep(wait);
  }
  throw new AppError(
    503,
    "O eGestor limitou as consultas (60 por minuto). Espere um minuto e clique em Atualizar de novo."
  );
}

async function requestToken(body: Record<string, string>): Promise<TokenCache> {
  const res = await fetchEgestor("/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await parseJson(res)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    errMsg?: string;
  } | null;
  if (!res.ok || !json?.access_token) {
    throw new Error(json?.errMsg || `eGestor OAuth falhou (${res.status})`);
  }
  const ttl = Number(json.expires_in || 900) * 1000;
  return {
    access: json.access_token,
    refresh: json.refresh_token || "",
    expiresAt: Date.now() + ttl - 30_000,
  };
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.access;
  if (tokenCache?.refresh) {
    try {
      tokenCache = await requestToken({
        grant_type: "refresh_token",
        refresh_token: tokenCache.refresh,
      });
      return tokenCache.access;
    } catch {
      tokenCache = null;
    }
  }
  const token = personalToken();
  if (!token) throw new Error("EGESTOR_PERSONAL_TOKEN não configurado");
  tokenCache = await requestToken({
    grant_type: "personal",
    personal_token: token,
  });
  return tokenCache.access;
}

async function egestorGetUnsafe(path: string): Promise<unknown> {
  const headersFor = (token: string) => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  });
  const token = await getAccessToken();
  let res = await fetchEgestor(path, { headers: headersFor(token) });
  if (res.status === 401) {
    tokenCache = null;
    const retryToken = await getAccessToken();
    res = await fetchEgestor(path, { headers: headersFor(retryToken) });
  }
  if (!res.ok) {
    throw new Error(`eGestor GET ${path} falhou (${res.status})`);
  }
  return parseJson(res);
}

async function egestorGet(path: string): Promise<unknown> {
  return withEgestorGate(() => egestorGetUnsafe(path));
}

const LIST_FIELDS =
  "codigo,codContato,nomeContato,codVendedor,dtVenda,dtCad,valorTotal,situacao,situacaoOS,tags";

export function egestorSyncDesde(): string {
  const v = (process.env.EGESTOR_SYNC_DT_INI || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : EGESTOR_SYNC_DESDE_PADRAO;
}

function mergeVendasPorCodigo(
  listas: EgestorVendaSummary[][]
): EgestorVendaSummary[] {
  const map = new Map<number, EgestorVendaSummary>();
  for (const lista of listas) {
    for (const row of lista) {
      const codigo = Number(row.codigo);
      if (!codigo) continue;
      const prev = map.get(codigo);
      map.set(codigo, prev ? { ...prev, ...row } : row);
    }
  }
  return [...map.values()];
}

export async function listarVendasEgestor(
  situacao: 10 | 50,
  opts?: { dtIni?: string; dtTipo?: "dtVenda" | "dtCad"; situOS?: string }
): Promise<EgestorVendaSummary[]> {
  const out: EgestorVendaSummary[] = [];
  let page = 1;
  let lastPage = 1;
  do {
    const q = new URLSearchParams({
      tipo: String(situacao),
      page: String(page),
      fields: LIST_FIELDS,
    });
    if (opts?.dtIni) q.set("dtIni", opts.dtIni);
    if (opts?.dtTipo) q.set("dtTipo", opts.dtTipo);
    if (opts?.situOS) q.set("situOS", opts.situOS);
    const json = (await egestorGet(`/v1/vendas?${q.toString()}`)) as {
      data?: EgestorVendaSummary[];
      last_page?: number;
    } | null;
    const rows = Array.isArray(json?.data) ? json!.data : [];
    out.push(...rows);
    lastPage = Number(json?.last_page || 1);
    page += 1;
  } while (page <= lastPage);
  return out;
}

export async function listarVendasParaSync(): Promise<EgestorVendaSummary[]> {
  const dtIni = egestorSyncDesde();
  const situOS = "Em espera";
  return mergeVendasPorCodigo([
    await listarVendasEgestor(EGESTOR_SITUACAO_ORCAMENTO, {
      dtIni,
      dtTipo: "dtCad",
      situOS,
    }),
    await listarVendasEgestor(EGESTOR_SITUACAO_ORCAMENTO, {
      dtIni,
      dtTipo: "dtVenda",
      situOS,
    }),
  ]);
}

function extrairProdutos(json: unknown): EgestorVendaProduto[] {
  if (!json || typeof json !== "object") return [];
  const raw = json as Record<string, unknown>;
  const nested =
    raw.data && typeof raw.data === "object"
      ? (raw.data as Record<string, unknown>)
      : raw;
  const produtos = nested.produtos;
  return Array.isArray(produtos) ? (produtos as EgestorVendaProduto[]) : [];
}

export async function obterVendaEgestor(codigo: number): Promise<{
  summary: EgestorVendaSummary;
  produtos: EgestorVendaProduto[];
}> {
  const json = (await egestorGet(`/v1/vendas/${codigo}`)) as
    | (EgestorVendaSummary & { produtos?: EgestorVendaProduto[]; data?: unknown })
    | null;
  const summarySource =
    json && typeof json === "object" && json.data && typeof json.data === "object"
      ? (json.data as EgestorVendaSummary)
      : (json as EgestorVendaSummary);
  return {
    summary: summarySource || ({} as EgestorVendaSummary),
    produtos: extrairProdutos(json),
  };
}

export type EgestorContato = {
  codigo?: number;
  nome?: string;
  nomeContato?: string;
  cpfcnpj?: string;
};

function extrairContato(json: unknown): EgestorContato | null {
  if (!json || typeof json !== "object") return null;
  const raw = json as Record<string, unknown>;
  const nested =
    raw.data && typeof raw.data === "object"
      ? (raw.data as Record<string, unknown>)
      : raw;
  if (!nested || typeof nested !== "object") return null;
  return nested as EgestorContato;
}

/** Detalhe do contato pelo código (cacheável entre pedidos). */
export async function obterContatoEgestor(
  codigo: number
): Promise<EgestorContato | null> {
  try {
    return extrairContato(await egestorGet(`/v1/contatos/${codigo}`));
  } catch (e) {
    console.warn(
      `[egestor] contato ${codigo}:`,
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/** Contato vinculado à venda (fallback se não houver codContato). */
export async function obterContatoVendaEgestor(
  codigoVenda: number
): Promise<EgestorContato | null> {
  try {
    return extrairContato(
      await egestorGet(`/v1/vendas/${codigoVenda}/contato`)
    );
  } catch (e) {
    console.warn(
      `[egestor] contato da venda ${codigoVenda}:`,
      e instanceof Error ? e.message : e
    );
    return null;
  }
}
