"use client";

import { getAccessToken } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/** Path relativo `/uploads/...` → URL absoluta autenticada da API. */
export function resolveAssetUrl(
  path: string | null | undefined
): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/uploads/")) {
    const base = `${API_URL}${path}`;
    const token =
      typeof window !== "undefined" ? getAccessToken() : null;
    if (!token) return base;
    return `${base}?token=${encodeURIComponent(token)}`;
  }
  return path;
}
