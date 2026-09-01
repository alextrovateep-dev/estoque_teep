"use client";

import { mensagemErroValidacao, MSG_VALIDACAO_GENERICA } from "@teep/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type User = {
  id: string;
  nome: string;
  email: string;
  perfil: "ADMIN" | "GERENTE" | "OPERADOR";
  filialId: string | null;
  /** Filiais vinculadas (Operador pode ter várias) */
  filialIds?: string[];
  fotoPerfil?: string | null;
  deveTrocarSenha?: boolean;
  apelido?: string | null;
  telefone?: string | null;
  dataNascimento?: string | null;
  perfilCompleto?: boolean;
  aniversarioHoje?: boolean;
  /**
   * Há estoque (filial) ativo no sistema.
   * Sem isso o admin pode navegar/cadastrar, mas operações de estoque ficam bloqueadas.
   */
  temEstoque?: boolean;
  /** Resolvidas no login/me (defaults do perfil + overrides) */
  permissoes?: import("@teep/shared").PermissoesUsuario;
};

/** IDs de filiais do usuário (multi ou legado). */
export function userFilialIds(
  user: Pick<User, "filialId" | "filialIds">
): string[] {
  if (user.filialIds && user.filialIds.length > 0) return user.filialIds;
  return user.filialId ? [user.filialId] : [];
}

/** Nome visual na plataforma (apelido) ou nome completo. */
export function displayName(user: Pick<User, "nome" | "apelido">): string {
  const a = user.apelido?.trim();
  return a || user.nome;
}

const ACCESS = "teep_access";
const USER = "teep_user";
/** Legado: refresh em localStorage (removido — cookie HttpOnly na API). */
const REFRESH_LEGACY = "teep_refresh";

const PUBLIC_AUTH_PATHS = ["/auth/login", "/auth/logout"];

function isPublicAuthPath(path: string): boolean {
  const base = path.split("?")[0] ?? path;
  return PUBLIC_AUTH_PATHS.includes(base);
}

function extractApiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as {
    error?: unknown;
    details?: {
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };
  };
  const fieldKey = Object.keys(b.details?.fieldErrors || {})[0];
  const fieldMsg = fieldKey
    ? (b.details?.fieldErrors?.[fieldKey] || []).find(
        (m) => typeof m === "string" && m.trim()
      )
    : undefined;
  if (typeof b.error === "string" && b.error.trim()) {
    return mensagemErroValidacao({
      message: b.error.trim(),
      path: fieldKey ? [fieldKey] : [],
    });
  }
  if (fieldMsg || fieldKey) {
    return mensagemErroValidacao({
      message: fieldMsg,
      path: fieldKey ? [fieldKey] : [],
    });
  }
  const fromForm = (b.details?.formErrors || []).find(
    (m) => typeof m === "string" && m.trim()
  );
  if (fromForm) {
    return mensagemErroValidacao({ message: fromForm });
  }
  return null;
}

function formatApiError(body: unknown, status: number): string {
  const fromBody = extractApiErrorMessage(body);
  if (fromBody) return fromBody;
  if (status === 401) return "Sessão expirada. Entre de novo e tente outra vez.";
  if (status === 403) return "Você não tem permissão para esta ação.";
  if (status === 502 || status === 503) {
    return "Serviço temporariamente indisponível. Tente de novo em instantes.";
  }
  if (status === 400) return MSG_VALIDACAO_GENERICA;
  if (status === 0) {
    return "Não foi possível contactar a API. Verifique sua conexão.";
  }
  return `Erro ${status}`;
}

async function parseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

const fetchCreds: RequestCredentials = "include";

/** Login direto (sem api() / refresh). */
export async function loginRequest(
  email: string,
  senha: string
): Promise<{ accessToken: string; user: User }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: fetchCreds,
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        senha,
      }),
    });
  } catch {
    throw new Error(
      `Não foi possível contactar a API (${API_URL}). Verifique DNS, HTTPS e CORS_ORIGIN.`
    );
  }

  const body = await parseJsonResponse(res);
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        extractApiErrorMessage(body) || "E-mail ou senha incorretos."
      );
    }
    if (res.status === 429) {
      throw new Error(
        extractApiErrorMessage(body) ||
          "Muitas tentativas de login. Aguarde 1 minuto."
      );
    }
    throw new Error(formatApiError(body, res.status));
  }
  return body as { accessToken: string; user: User };
}

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER);
  return raw ? (JSON.parse(raw) as User) : null;
}

export function getAccessToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS);
}

/** Persiste access + user. Refresh fica só em cookie HttpOnly (API). */
export function setSession(data: {
  accessToken: string;
  refreshToken?: string;
  user: User;
}) {
  localStorage.setItem(ACCESS, data.accessToken);
  localStorage.setItem(USER, JSON.stringify(data.user));
  localStorage.removeItem(REFRESH_LEGACY);
}

export function patchStoredUser(partial: Partial<User>) {
  const u = getStoredUser();
  if (!u) return;
  localStorage.setItem(USER, JSON.stringify({ ...u, ...partial }));
}

export function clearSession() {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(USER);
  localStorage.removeItem(REFRESH_LEGACY);
}

function jwtExpMs(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Garante access token válido (renova via cookie HttpOnly se perto do expiry).
 * Usado por API e Socket.
 */
export async function ensureAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const access = localStorage.getItem(ACCESS);
  const hasUser = Boolean(localStorage.getItem(USER));
  if (!access && !hasUser) return null;

  const exp = access ? jwtExpMs(access) : null;
  const stale = !access || exp === null || exp < Date.now() + 60_000;

  if (!stale && access) return access;
  if (!hasUser && !access) return null;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refreshed = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: fetchCreds,
          body: JSON.stringify({}),
        });
        if (!refreshed.ok) {
          clearSession();
          return null;
        }
        const data = (await refreshed.json()) as { accessToken: string };
        localStorage.setItem(ACCESS, data.accessToken);
        localStorage.removeItem(REFRESH_LEGACY);
        return data.accessToken;
      } catch {
        return localStorage.getItem(ACCESS);
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function logoutSession() {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(getAccessToken()
          ? { Authorization: `Bearer ${getAccessToken()}` }
          : {}),
      },
      credentials: fetchCreds,
      body: JSON.stringify({}),
    });
  } catch {
    // limpa sessão local mesmo se a API falhar
  }
  clearSession();
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const publicAuth = isPublicAuthPath(path);
  const token = publicAuth ? null : getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: fetchCreds,
  });

  if (res.status === 401 && getStoredUser() && !publicAuth) {
    const fresh = await ensureAccessToken();
    if (fresh) {
      headers.set("Authorization", `Bearer ${fresh}`);
      res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
        credentials: fetchCreds,
      });
    } else {
      clearSession();
      if (typeof window !== "undefined") window.location.href = "/login";
      throw new Error("Sessão expirada");
    }
  }

  const body = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(formatApiError(body, res.status));
  }
  return body as T;
}

/** Upload multipart (não define Content-Type — o browser seta boundary). */
export async function apiUpload<T>(
  path: string,
  formData: FormData
): Promise<T> {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: formData,
    credentials: fetchCreds,
  });

  if (res.status === 401 && getStoredUser()) {
    const fresh = await ensureAccessToken();
    if (fresh) {
      headers.set("Authorization", `Bearer ${fresh}`);
      res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers,
        body: formData,
        credentials: fetchCreds,
      });
    } else {
      clearSession();
      if (typeof window !== "undefined") window.location.href = "/login";
      throw new Error("Sessão expirada");
    }
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(formatApiError(body, res.status));
  }
  return body as T;
}

/** Download binário (PDF/Excel) com auth + refresh. */
export async function apiDownload(
  path: string,
  options: RequestInit & { fallbackFilename?: string } = {}
): Promise<{ blob: Blob; filename: string }> {
  const { fallbackFilename, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers,
    credentials: fetchCreds,
  });

  if (res.status === 401 && getStoredUser()) {
    const fresh = await ensureAccessToken();
    if (fresh) {
      headers.set("Authorization", `Bearer ${fresh}`);
      res = await fetch(`${API_URL}${path}`, {
        ...fetchOptions,
        headers,
        credentials: fetchCreds,
      });
    } else {
      clearSession();
      if (typeof window !== "undefined") window.location.href = "/login";
      throw new Error("Sessão expirada");
    }
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(formatApiError(errBody, res.status));
  }

  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename\*?=(?:UTF-8''|")?([^\";]+)"?/i.exec(disposition);
  let filename = match?.[1] ? decodeURIComponent(match[1].replace(/"/g, "")) : "";
  if (!filename || filename === "download") {
    filename = fallbackFilename || "download";
  }
  const blob = await res.blob();
  return { blob, filename };
}
