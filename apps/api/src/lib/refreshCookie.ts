import type { CookieOptions, Request, Response } from "express";

export const REFRESH_COOKIE_NAME = "teep_refresh";

const REFRESH_DAYS = 7;

export function refreshExpiresAt(from = new Date()): Date {
  const expiresAt = new Date(from);
  expiresAt.setDate(expiresAt.getDate() + REFRESH_DAYS);
  return expiresAt;
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Opções do cookie HttpOnly do refresh (Path=/auth). */
export function refreshCookieOptions(expiresAt: Date): CookieOptions {
  const secure =
    process.env.REFRESH_COOKIE_SECURE === "1" ||
    process.env.REFRESH_COOKIE_SECURE === "true" ||
    isProd();
  const sameSiteEnv = (process.env.REFRESH_COOKIE_SAMESITE || "").toLowerCase();
  const sameSite: CookieOptions["sameSite"] =
    sameSiteEnv === "none" || sameSiteEnv === "lax" || sameSiteEnv === "strict"
      ? sameSiteEnv
      : // Cross-origin com credentials em produção: None+Secure.
        // Dev (localhost:3000 → :4000): Lax sem Secure.
        isProd()
        ? "none"
        : "lax";

  return {
    httpOnly: true,
    secure: sameSite === "none" ? true : secure,
    sameSite,
    path: "/auth",
    expires: expiresAt,
  };
}

export function setRefreshCookie(
  res: Response,
  token: string,
  expiresAt: Date
): void {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(expiresAt));
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    ...refreshCookieOptions(new Date(0)),
    expires: new Date(0),
    maxAge: 0,
  });
}

/** Cookie HttpOnly (preferido) ou body legado (scripts/smoke). */
export function readRefreshToken(req: Request): string {
  const fromCookie = String(req.cookies?.[REFRESH_COOKIE_NAME] || "").trim();
  if (fromCookie) return fromCookie;
  return String(req.body?.refreshToken || "").trim();
}
