"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { getStoredUser, logoutSession, User, api, displayName } from "@/lib/api";
import { homeForUser, userCanOpenCadastro, userHas, userHasAny } from "@/lib/access";
import { resolveAssetUrl } from "@/lib/assets";
import { NotificationBell } from "@/components/NotificationBell";
import { TeepLogo } from "@/components/TeepLogo";
import { PermissaoKey } from "@teep/shared";

type NavItem = {
  href: string;
  label: string;
  section?: "admin" | "ops";
  /** Subgrupo visual da operação (cadastros de domínio ficam em ops). */
  group?: "visao" | "operacoes" | "rma" | "controle" | "cadastros";
  /** Uma key ou qualquer uma da lista. */
  perm?: PermissaoKey | readonly PermissaoKey[];
};

const OPS_GROUP_LABELS: Record<NonNullable<NavItem["group"]>, string> = {
  visao: "Visão",
  operacoes: "Operações",
  rma: "Processo RMA",
  controle: "Controle",
  cadastros: "Cadastros",
};

const OPS_GROUP_ORDER: NonNullable<NavItem["group"]>[] = [
  "visao",
  "operacoes",
  "rma",
  "controle",
  "cadastros",
];

function routeAllowed(pathname: string, user: User): boolean {
  if (pathname.startsWith("/admin")) return user.perfil === "ADMIN";
  if (pathname.startsWith("/trocar-senha")) return true;
  if (pathname.startsWith("/perfil")) return true;
  if (pathname.startsWith("/sem-acesso")) return true;

  if (pathname.startsWith("/estoque/series")) {
    return userHas(user, "dashboard") || userHas(user, "movimentacoes");
  }

  if (pathname.startsWith("/cadastros/rma-checklists")) {
    return userHas(user, "rma");
  }
  if (pathname.startsWith("/cadastros/produtos")) {
    return userCanOpenCadastro(user, "produtos");
  }
  if (pathname.startsWith("/cadastros/clientes")) {
    return userCanOpenCadastro(user, "clientes");
  }
  if (pathname.startsWith("/cadastros/arvore")) {
    return userCanOpenCadastro(user, "arvore");
  }
  if (pathname.startsWith("/cadastros")) {
    return (
      userHas(user, "rma") ||
      userCanOpenCadastro(user, "produtos") ||
      userCanOpenCadastro(user, "clientes") ||
      userCanOpenCadastro(user, "arvore")
    );
  }

  const checks: Array<[string, PermissaoKey]> = [
    ["/estoque/init", "estoque_init"],
    ["/aprovacoes", "aprovacoes"],
    ["/rma", "rma"],
    ["/relatorios", "relatorios"],
    ["/dashboard", "dashboard"],
    ["/lancamentos", "lancamentos"],
    ["/pedidos", "pedidos"],
    ["/transferencias", "transferencias"],
    ["/movimentacoes", "movimentacoes"],
  ];
  for (const [prefix, key] of checks) {
    if (pathname.startsWith(prefix)) {
      return userHas(user, key);
    }
  }
  return true;
}

function bdayDismissKey(userId: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `teep_bday_${userId}_${ymd}`;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [pendentesAprovacao, setPendentesAprovacao] = useState(0);
  const [showBday, setShowBday] = useState(false);
  const meFetchedRef = useRef(false);

  /** Sessão local + redirects; /auth/me só na 1ª montagem do shell (persiste entre páginas). */
  useEffect(() => {
    const u = getStoredUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    if (u.deveTrocarSenha && pathname !== "/trocar-senha") {
      router.replace("/trocar-senha");
      return;
    }
    if (
      !u.deveTrocarSenha &&
      u.perfilCompleto === false &&
      !pathname.startsWith("/perfil")
    ) {
      router.replace("/perfil?completar=1");
      return;
    }
    if (!routeAllowed(pathname, u)) {
      router.replace(homeForUser(u));
      return;
    }
    setUser(u);
    setOpen(false);

    const onUserUpdated = () => {
      const latest = getStoredUser();
      if (latest) setUser(latest);
    };
    window.addEventListener("teep-user-updated", onUserUpdated);

    if (meFetchedRef.current) {
      return () => window.removeEventListener("teep-user-updated", onUserUpdated);
    }
    meFetchedRef.current = true;
    void api<User>("/auth/me")
      .then((me) => {
        const next: User = {
          id: me.id,
          nome: me.nome,
          email: me.email,
          perfil: me.perfil,
          filialId: me.filialId,
          filialIds: me.filialIds ?? [],
          fotoPerfil: me.fotoPerfil ?? null,
          deveTrocarSenha: me.deveTrocarSenha,
          apelido: me.apelido ?? null,
          telefone: me.telefone ?? null,
          dataNascimento: me.dataNascimento ?? null,
          perfilCompleto: me.perfilCompleto,
          aniversarioHoje: me.aniversarioHoje,
          temEstoque: me.temEstoque,
          permissoes: me.permissoes,
        };
        localStorage.setItem("teep_user", JSON.stringify(next));
        setUser(next);
        if (next.deveTrocarSenha && pathname !== "/trocar-senha") {
          router.replace("/trocar-senha");
          return;
        }
        if (
          !next.deveTrocarSenha &&
          next.perfilCompleto === false &&
          !pathname.startsWith("/perfil")
        ) {
          router.replace("/perfil?completar=1");
          return;
        }
        if (!routeAllowed(pathname, next)) {
          router.replace(homeForUser(next));
        }
        if (
          next.aniversarioHoje &&
          !sessionStorage.getItem(bdayDismissKey(next.id))
        ) {
          setShowBday(true);
        }
      })
      .catch(() => {
        meFetchedRef.current = false;
      });

    return () => window.removeEventListener("teep-user-updated", onUserUpdated);
  }, [router, pathname]);

  useEffect(() => {
    if (!user || !userHas(user, "aprovacoes")) {
      setPendentesAprovacao(0);
      return;
    }
    let cancelled = false;
    const load = () => {
      void Promise.all([
        api<{ total: number }>("/movimentacoes?status=PENDENTE&pageSize=1"),
        api<{ total: number }>("/transferencias/pendentes-aprovacao/count"),
      ])
        .then(([movs, tr]) => {
          if (!cancelled) {
            setPendentesAprovacao((movs.total || 0) + (tr.total || 0));
          }
        })
        .catch(() => {
          if (!cancelled) setPendentesAprovacao(0);
        });
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [user]);

  const items = useMemo(() => {
    if (!user) return [] as NavItem[];
    const isAdmin = user.perfil === "ADMIN";

    const opsAll: NavItem[] = [
      // Visão — consulta / indicadores
      {
        href: "/dashboard",
        label: "Dashboard / Saldos",
        section: "ops",
        group: "visao",
        perm: "dashboard",
      },
      {
        href: "/relatorios",
        label: "Relatórios",
        section: "ops",
        group: "visao",
        perm: "relatorios",
      },
      // Operações — ações do dia
      {
        href: "/lancamentos/novo",
        label: "Novo Lançamento",
        section: "ops",
        group: "operacoes",
        perm: "lancamentos",
      },
      {
        href: "/pedidos",
        label: "Pedidos",
        section: "ops",
        group: "operacoes",
        perm: "pedidos",
      },
      {
        href: "/transferencias",
        label: "Transferências",
        section: "ops",
        group: "operacoes",
        perm: "transferencias",
      },
      // Processo RMA — fluxo de garantia / assistência
      {
        href: "/rma",
        label: "Processos",
        section: "ops",
        group: "rma",
        perm: "rma",
      },
      {
        href: "/cadastros/rma-checklists",
        label: "Checklists",
        section: "ops",
        group: "rma",
        perm: "rma",
      },
      // Controle — histórico, filas e ajustes
      {
        href: "/movimentacoes",
        label: "Movimentações",
        section: "ops",
        group: "controle",
        perm: "movimentacoes",
      },
      {
        href: "/aprovacoes",
        label: "Aprovações",
        section: "ops",
        group: "controle",
        perm: "aprovacoes",
      },
      {
        href: "/estoque/init",
        label: "Inventário",
        section: "ops",
        group: "controle",
        perm: "estoque_init",
      },
      // Cadastros — dados mestres (inclui itens só Admin)
      {
        href: "/cadastros/produtos",
        label: "Produtos",
        section: "ops",
        group: "cadastros",
        perm: ["cadastros_produtos_ver", "cadastros_produtos_editar"],
      },
      {
        href: "/cadastros/clientes",
        label: "Clientes / Fornecedores",
        section: "ops",
        group: "cadastros",
        perm: ["cadastros_clientes_ver", "cadastros_clientes_editar"],
      },
      {
        href: "/cadastros/arvore",
        label: "Árvore de produto",
        section: "ops",
        group: "cadastros",
        perm: ["cadastros_arvore_ver", "cadastros_arvore_editar"],
      },
      ...(isAdmin
        ? [
            {
              href: "/admin/categorias",
              label: "Categorias",
              section: "ops" as const,
              group: "cadastros" as const,
            },
            {
              href: "/admin/filiais",
              label: "Estoques",
              section: "ops" as const,
              group: "cadastros" as const,
            },
          ]
        : []),
    ];
    const ops = opsAll.filter((item) => {
      if (!item.perm) return true;
      const p = item.perm;
      if (typeof p === "string") return userHas(user, p);
      return userHasAny(user, p);
    });

    // Administração — configuração do sistema (no fim do menu)
    const admin: NavItem[] = [];
    if (isAdmin) {
      admin.push(
        {
          href: "/admin/usuarios",
          label: "Usuários e Perfis",
          section: "admin",
        },
        {
          href: "/admin/tipos",
          label: "Tipos de Movimentação",
          section: "admin",
        },
        {
          href: "/admin/email",
          label: "E-mails do sistema",
          section: "admin",
        }
      );
    }
    return [...ops, ...admin];
  }, [user]);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Carregando…
      </div>
    );
  }

  async function logout() {
    await logoutSession();
    router.replace("/login");
  }

  const avatarImg = resolveAssetUrl(user.fotoPerfil) ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolveAssetUrl(user.fotoPerfil)!}
      alt=""
      className="h-8 w-8 rounded-full object-cover"
    />
  ) : (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
      {displayName(user).slice(0, 1).toUpperCase()}
    </div>
  );

  const headerProfile = (
    <Link
      href="/perfil"
      className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-slate-50"
      title="Meu perfil"
    >
      <div className="shrink-0" aria-hidden>
        {avatarImg}
      </div>
      <div className="hidden min-w-0 sm:block">
        <div className="max-w-[10rem] truncate text-sm font-medium text-slate-800">
          {displayName(user)}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-slate-400">
          {user.perfil}
        </div>
      </div>
    </Link>
  );

  const opsItems = items.filter((i) => i.section === "ops");
  const adminItems = items.filter((i) => i.section === "admin");

  function renderNavLink(item: NavItem) {
    const showBadge = item.href === "/aprovacoes" && pendentesAprovacao > 0;
    /** Prefere o item mais específico quando vários prefixos batem. */
    const candidates = items.filter(
      (i) => pathname === i.href || pathname.startsWith(`${i.href}/`)
    );
    const best =
      candidates.length === 0
        ? null
        : candidates.reduce((a, b) => (a.href.length >= b.href.length ? a : b));
    const active = best?.href === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setOpen(false)}
        className={clsx(
          "flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm font-medium",
          active
            ? "bg-brand text-white"
            : "text-slate-700 hover:bg-brand-light"
        )}
      >
        <span>{item.label}</span>
        {showBadge && (
          <span
            className={clsx(
              "min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums",
              active
                ? "bg-white/20 text-white"
                : "bg-amber-100 text-amber-900"
            )}
            title={`${pendentesAprovacao} pendente(s)`}
          >
            {pendentesAprovacao > 99 ? "99+" : pendentesAprovacao}
          </span>
        )}
      </Link>
    );
  }

  function SidebarBody() {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-slate-200 px-3 py-2.5">
          <TeepLogo variant="full" height={22} />
          <p className="mt-0.5 text-[11px] leading-tight text-slate-400">
            Controle de estoque
          </p>
        </div>

        <nav className="scrollbar-ghost min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5">
          <div className="flex flex-col gap-0.5">
            {OPS_GROUP_ORDER.map((group) => {
              const groupItems = opsItems.filter((i) => i.group === group);
              if (groupItems.length === 0) return null;
              return (
                <div key={group}>
                  <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400/90">
                    {OPS_GROUP_LABELS[group]}
                  </p>
                  {groupItems.map(renderNavLink)}
                </div>
              );
            })}

            {adminItems.length > 0 && (
              <div>
                <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Administração
                </p>
                {adminItems.map(renderNavLink)}
              </div>
            )}
          </div>
        </nav>

        <div className="mt-auto shrink-0 border-t border-slate-200 bg-white px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-brand-light"
          >
            <span>Sair</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-64 shrink-0 self-start border-r border-slate-200 bg-white md:sticky md:top-0 md:flex md:h-dvh md:max-h-dvh md:flex-col md:overflow-hidden">
        <SidebarBody />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          />
          <aside className="absolute left-0 top-0 flex h-dvh max-h-dvh min-h-0 w-72 flex-col overflow-hidden bg-white shadow-xl">
            <SidebarBody />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 md:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:hidden"
          >
            Menu
          </button>
          <div className="md:hidden">
            <TeepLogo variant="full" height={24} />
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {headerProfile}
            <NotificationBell />
          </div>
        </header>
        {showBday && (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 md:px-6">
            <p>
              Feliz aniversário, <strong>{displayName(user)}</strong>! Desejamos
              um ótimo dia.
            </p>
            <button
              type="button"
              className="shrink-0 text-amber-800/70 hover:text-amber-950"
              onClick={() => {
                sessionStorage.setItem(bdayDismissKey(user.id), "1");
                setShowBday(false);
              }}
              aria-label="Fechar"
            >
              Fechar
            </button>
          </div>
        )}
        {user.temEstoque === false && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 md:px-6">
            <p>
              {user.perfil === "ADMIN" ? (
                <>
                  Cadastre ao menos um <strong>estoque</strong> para liberar
                  lançamentos, transferências e RMA. Você pode navegar no
                  sistema, mas operações ficam bloqueadas até lá.
                </>
              ) : (
                <>
                  Ainda não há estoque cadastrado. Operações ficam bloqueadas
                  até um administrador criar ao menos um estoque em{" "}
                  <strong>Cadastros → Estoques</strong>.
                </>
              )}
            </p>
            {user.perfil === "ADMIN" &&
              !pathname.startsWith("/admin/filiais") && (
                <Link
                  href="/admin/filiais/novo"
                  className="shrink-0 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800"
                >
                  Cadastrar estoque
                </Link>
              )}
          </div>
        )}
        <main className="p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
