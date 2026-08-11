"use client";

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
const REFRESH = "teep_refresh";
const USER = "teep_user";

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER);
  return raw ? (JSON.parse(raw) as User) : null;
}

export function getAccessToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS);
}

export function setSession(data: {
  accessToken: string;
  refreshToken: string;
  user: User;
}) {
  localStorage.setItem(ACCESS, data.accessToken);
  localStorage.setItem(REFRESH, data.refreshToken);
  localStorage.setItem(USER, JSON.stringify(data.user));
}

export function patchStoredUser(partial: Partial<User>) {
  const u = getStoredUser();
  if (!u) return;
  localStorage.setItem(USER, JSON.stringify({ ...u, ...partial }));
}

export function clearSession() {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
  localStorage.removeItem(USER);
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

/** Garante access token válido (renova se perto do expiry). Usado por API e Socket. */
export async function ensureAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const access = localStorage.getItem(ACCESS);
  const refresh = localStorage.getItem(REFRESH);
  if (!access && !refresh) return null;

  const exp = access ? jwtExpMs(access) : null;
  const stale =
    !access || exp === null || exp < Date.now() + 60_000;

  if (!stale && access) return access;
  if (!refresh) return access;

  try {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!refreshed.ok) {
      clearSession();
      return null;
    }
    const data = (await refreshed.json()) as { accessToken: string };
    localStorage.setItem(ACCESS, data.accessToken);
    return data.accessToken;
  } catch {
    return access;
  }
}

export async function logoutSession() {
  const refreshToken =
    typeof window !== "undefined" ? localStorage.getItem(REFRESH) : null;
  try {
    if (refreshToken || getAccessToken()) {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getAccessToken()
            ? { Authorization: `Bearer ${getAccessToken()}` }
            : {}),
        },
        body: JSON.stringify({ refreshToken }),
      });
    }
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
  headers.set("Content-Type", "application/json");
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && localStorage.getItem(REFRESH)) {
    const fresh = await ensureAccessToken();
    if (fresh) {
      headers.set("Authorization", `Bearer ${fresh}`);
      res = await fetch(`${API_URL}${path}`, { ...options, headers });
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

function formatApiError(body: unknown, status: number): string {
  if (!body || typeof body !== "object") return `Erro ${status}`;
  const b = body as {
    error?: unknown;
    details?: {
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };
  };
  const isUseless = (m: string) => {
    const t = m.trim().toLowerCase();
    return !t || t === "required" || t === "invalid" || t === "dados inválidos";
  };
  if (typeof b.error === "string" && b.error.trim() && !isUseless(b.error)) {
    return b.error.trim();
  }
  const fromFields = Object.values(b.details?.fieldErrors || {})
    .flat()
    .find((m) => typeof m === "string" && !isUseless(m));
  if (fromFields) return fromFields;
  const fromForm = (b.details?.formErrors || []).find(
    (m) => typeof m === "string" && !isUseless(m)
  );
  if (fromForm) return fromForm;
  if (typeof b.error === "string" && b.error.trim()) return b.error.trim();
  return `Erro ${status}`;
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
  });

  if (res.status === 401 && localStorage.getItem(REFRESH)) {
    const fresh = await ensureAccessToken();
    if (fresh) {
      headers.set("Authorization", `Bearer ${fresh}`);
      res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers,
        body: formData,
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

  let res = await fetch(`${API_URL}${path}`, { ...fetchOptions, headers });

  if (res.status === 401 && localStorage.getItem(REFRESH)) {
    const fresh = await ensureAccessToken();
    if (fresh) {
      headers.set("Authorization", `Bearer ${fresh}`);
      res = await fetch(`${API_URL}${path}`, { ...fetchOptions, headers });
    } else {
      clearSession();
      if (typeof window !== "undefined") window.location.href = "/login";
      throw new Error("Sessão expirada");
    }
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      (errBody as { error?: string }).error || `Erro ${res.status}`
    );
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
