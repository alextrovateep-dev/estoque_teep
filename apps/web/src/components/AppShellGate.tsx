"use client";

import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

/** Rotas sem menu lateral (login / onboarding / escape). */
function isBareRoute(pathname: string): boolean {
  if (pathname === "/" || pathname === "/login") return true;
  if (pathname === "/trocar-senha" || pathname === "/sem-acesso") return true;
  return false;
}

/**
 * Mantém o AppShell montado entre páginas autenticadas.
 * Evita refazer /auth/me, contagens e socket a cada troca de rota.
 */
export function AppShellGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  if (isBareRoute(pathname)) return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
