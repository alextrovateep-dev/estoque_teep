import {
  CADASTROS_PAGINAS,
  CadastrosPaginaId,
  DASHBOARD_KPI_KEYS,
  hasCadastroEditar,
  hasCadastroPagina,
  hasPermissao,
  hasQualquerCadastro,
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

export function userHas(user: User, key: PermissaoKey): boolean {
  return hasPermissao(user.perfil, effectivePermissoes(user), key);
}

export function userHasAny(
  user: User,
  keys: readonly PermissaoKey[]
): boolean {
  return keys.some((k) => userHas(user, k));
}

export function userCanOpenCadastro(
  user: User,
  pagina: CadastrosPaginaId
): boolean {
  if (user.perfil === "ADMIN") return true;
  return hasCadastroPagina(effectivePermissoes(user), pagina);
}

export function userCanEditCadastro(
  user: User,
  pagina: CadastrosPaginaId
): boolean {
  if (user.perfil === "ADMIN") return true;
  return hasCadastroEditar(effectivePermissoes(user), pagina);
}

export function userHasAnyCadastro(user: User): boolean {
  if (user.perfil === "ADMIN") return true;
  return hasQualquerCadastro(effectivePermissoes(user));
}

/**
 * Home pós-login / pós-troca de senha / AppShell.
 * Única fonte — não duplicar cadeias por perfil.
 */
export function homeForUser(user: User): string {
  if (user.temEstoque === false && user.perfil === "ADMIN") {
    return "/admin/filiais?setup=1";
  }
  const order: Array<{ href: string; key: PermissaoKey }> = [
    { href: "/dashboard", key: "dashboard" },
    { href: "/relatorios", key: "relatorios" },
    { href: "/lancamentos/novo", key: "lancamentos" },
    { href: "/pedidos", key: "pedidos" },
    { href: "/transferencias", key: "transferencias" },
    { href: "/movimentacoes", key: "movimentacoes" },
    { href: "/aprovacoes", key: "aprovacoes" },
    { href: "/rma", key: "rma" },
    { href: "/estoque/init", key: "estoque_init" },
  ];
  for (const item of order) {
    if (userHas(user, item.key)) return item.href;
  }
  for (const p of CADASTROS_PAGINAS) {
    if (userCanOpenCadastro(user, p.id)) return p.href;
  }
  if (user.perfil === "ADMIN") return "/admin/usuarios";
  return "/sem-acesso";
}

/** True se o usuário tem ao menos uma tela operacional liberada. */
export function userHasAnyOpsAccess(user: User): boolean {
  if (user.perfil === "ADMIN") return true;
  const keys: PermissaoKey[] = [
    "dashboard",
    "relatorios",
    "lancamentos",
    "transferencias",
    "movimentacoes",
    "aprovacoes",
    "estoque_init",
    "rma",
    "pedidos",
  ];
  if (keys.some((k) => userHas(user, k))) return true;
  return userHasAnyCadastro(user);
}

/** Keys que o perfil pode receber na moderação (além do Admin). */
export function permissoesEditaveisParaPerfil(
  perfil: User["perfil"]
): readonly PermissaoKey[] {
  const cadastroKeys = CADASTROS_PAGINAS.flatMap(
    (p) => [p.ver, p.editar] as const
  );
  if (perfil === "ADMIN" || perfil === "GERENTE") {
    return [
      "dashboard",
      ...DASHBOARD_KPI_KEYS,
      "assistente",
      "relatorios",
      "lancamentos",
      "pedidos",
      "transferencias",
      "movimentacoes",
      "aprovacoes",
      ...cadastroKeys,
      "estoque_init",
      "rma",
      "rma_cobranca",
    ] as const;
  }
  return [
    "dashboard",
    ...DASHBOARD_KPI_KEYS,
    "assistente",
    "relatorios",
    "lancamentos",
    "pedidos",
    "transferencias",
    "movimentacoes",
    "rma",
  ] as const;
}
