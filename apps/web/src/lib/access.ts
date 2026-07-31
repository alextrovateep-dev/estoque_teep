import {
  hasPermissao,
  PermissaoKey,
  PermissoesUsuario,
  defaultPermissoes,
} from "@teep/shared";
import type { User } from "@/lib/api";

/** Permissões efetivas (ADMIN = tudo; senão snapshot do login/me ou defaults). */
export function effectivePermissoes(user: User): PermissoesUsuario {
  if (user.perfil === "ADMIN") return defaultPermissoes("ADMIN");
  return user.permissoes || defaultPermissoes(user.perfil);
}

export function userHas(
  user: User,
  key: PermissaoKey
): boolean {
  return hasPermissao(user.perfil, effectivePermissoes(user), key);
}

/**
 * Home pós-login / pós-troca de senha / AppShell.
 * Única fonte — não duplicar cadeias por perfil.
 */
export function homeForUser(user: User): string {
  const order: Array<{ href: string; key: PermissaoKey }> = [
    { href: "/dashboard", key: "dashboard" },
    { href: "/lancamentos/novo", key: "lancamentos" },
    { href: "/transferencias", key: "transferencias" },
    { href: "/movimentacoes", key: "movimentacoes" },
    { href: "/aprovacoes", key: "aprovacoes" },
    { href: "/cadastros/produtos", key: "cadastros" },
    { href: "/estoque/init", key: "estoque_init" },
  ];
  for (const item of order) {
    if (userHas(user, item.key)) return item.href;
  }
  if (user.perfil === "ADMIN") return "/admin/usuarios";
  return "/sem-acesso";
}

/** True se o usuário tem ao menos uma tela operacional liberada. */
export function userHasAnyOpsAccess(user: User): boolean {
  if (user.perfil === "ADMIN") return true;
  const keys: PermissaoKey[] = [
    "dashboard",
    "lancamentos",
    "transferencias",
    "movimentacoes",
    "aprovacoes",
    "cadastros",
    "estoque_init",
  ];
  return keys.some((k) => userHas(user, k));
}

/** Keys que o perfil pode receber na moderação (além do Admin). */
export function permissoesEditaveisParaPerfil(
  perfil: User["perfil"]
): readonly PermissaoKey[] {
  if (perfil === "ADMIN") {
    return [
      "dashboard",
      "assistente",
      "lancamentos",
      "transferencias",
      "movimentacoes",
      "aprovacoes",
      "cadastros",
      "estoque_init",
    ] as const;
  }
  if (perfil === "GERENTE") {
    return [
      "dashboard",
      "assistente",
      "lancamentos",
      "transferencias",
      "movimentacoes",
      "aprovacoes",
      "cadastros",
      "estoque_init",
    ] as const;
  }
  // OPERADOR: ações de gestão continuam exigindo GERENTE/ADMIN na API
  return [
    "dashboard",
    "assistente",
    "lancamentos",
    "transferencias",
    "movimentacoes",
  ] as const;
}
