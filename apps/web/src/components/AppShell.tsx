"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { getStoredUser, logoutSession, User, api, displayName } from "@/lib/api";
import { homeForUser, userHas } from "@/lib/access";
import { resolveAssetUrl } from "@/lib/assets";
import { NotificationBell } from "@/components/NotificationBell";
import { TeepLogo } from "@/components/TeepLogo";
import { PermissaoKey } from "@teep/shared";

type NavItem = {
  href: string;
  label: string;
  section?: "admin" | "ops";
  /** Subgrupo visual dentro de Operação */
  group?: "visao" | "dia" | "controle" | "cadastros" | "inventario";
  perm?: PermissaoKey;
};

const OPS_GROUP_LABELS: Record<NonNullable<NavItem["group"]>, string> = {
  visao: "Operação/Visão",
  dia: "Dia a dia",
  controle: "Controle",
  cadastros: "Cadastros",
  inventario: "Inventário",
};

const OPS_GROUP_ORDER: NonNullable<NavItem["group"]>[] = [
  "visao",
  "dia",
  "controle",
  "cadastros",
  "inventario",
];

function routeAllowed(pathname: string, user: User): boolean {
  if (pathname.startsWith("/admin")) return user.perfil === "ADMIN";
  if (pathname.startsWith("/trocar-senha")) return true;
  if (pathname.startsWith("/perfil")) return true;
  if (pathname.startsWith("/sem-acesso")) return true;

  const checks: Array<[string, PermissaoKey]> = [
    ["/estoque/init", "estoque_init"],
    ["/estoque/series", "movimentacoes"],
    ["/cadastros", "cadastros"],
    ["/aprovacoes", "aprovacoes"],
    ["/dashboard", "dashboard"],
    ["/lancamentos", "lancamentos"],
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

    if (meFetchedRef.current) return;
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
    const opsAll: NavItem[] = [
      {
        href: "/dashboard",
        label: "Dashboard / Saldos",
        section: "ops",
        group: "visao",
        perm: "dashboard",
      },
      {
        href: "/lancamentos/novo",
        label: "Novo Lançamento",
        section: "ops",
        group: "dia",
        perm: "lancamentos",
      },
      {
        href: "/transferencias",
        label: "Confirmar Recebimento",
        section: "ops",
        group: "dia",
        perm: "transferencias",
      },
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
        href: "/cadastros/produtos",
        label: "Produtos",
        section: "ops",
        group: "cadastros",
        perm: "cadastros",
      },
      {
        href: "/cadastros/categorias",
        label: "Categorias",
        section: "ops",
        group: "cadastros",
        perm: "cadastros",
      },
      {
        href: "/cadastros/clientes",
        label: "Clientes",
        section: "ops",
        group: "cadastros",
        perm: "cadastros",
      },
      {
        href: "/estoque/init",
        label: "Inventário",
        section: "ops",
        group: "inventario",
        perm: "estoque_init",
      },
      {
        href: "/estoque/series",
        label: "Números de série",
        section: "ops",
        group: "controle",
        perm: "movimentacoes",
      },
    ];
    const ops = opsAll.filter((item) =>
      item.perm ? userHas(user, item.perm) : true
    );

    const admin: NavItem[] = [];
    if (user.perfil === "ADMIN") {
      admin.push(
        { href: "/admin/filiais", label: "Filiais", section: "admin" },
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
    return [...admin, ...ops];
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
    const active =
      pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setOpen(false)}
        className={clsx(
          "flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium",
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

  function SidebarNav() {
    return (
      <nav className="scrollbar-ghost flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-3">
        {adminItems.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Área Admin
            </p>
            {adminItems.map(renderNavLink)}
          </>
        )}

        {OPS_GROUP_ORDER.map((group) => {
          const groupItems = opsItems.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} className="mt-1">
              <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-slate-400/90">
                {OPS_GROUP_LABELS[group]}
              </p>
              {groupItems.map(renderNavLink)}
            </div>
          );
        })}
      </nav>
    );
  }

  function SidebarFooter() {
    return (
      <div className="shrink-0 border-t border-slate-100 pb-1 pt-1">
        <Link
          href="/perfil"
          onClick={() => setOpen(false)}
          className={clsx(
            "mx-3 mb-1 block rounded-lg px-3 py-2.5 text-sm font-medium",
            pathname.startsWith("/perfil")
              ? "bg-brand text-white"
              : "text-slate-700 hover:bg-brand-light"
          )}
        >
          Meu perfil
        </Link>
        <button
          type="button"
          onClick={logout}
          className="mx-3 mb-3 mt-0 block w-[calc(100%-1.5rem)] rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Sair
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen md:flex md:h-dvh md:max-h-dvh md:overflow-hidden">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:flex md:h-full md:flex-col md:overflow-hidden">
        <div className="shrink-0 border-b border-slate-200 px-4 py-4">
          <TeepLogo variant="full" height={28} priority />
          <p className="mt-1.5 text-xs text-slate-400">Controle de estoque</p>
        </div>
        <SidebarNav />
        <SidebarFooter />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          />
          <aside className="absolute left-0 top-0 flex h-full max-h-dvh w-72 flex-col overflow-hidden bg-white shadow-xl">
            <div className="shrink-0 border-b border-slate-200 px-4 py-4">
              <TeepLogo variant="full" height={28} />
            </div>
            <SidebarNav />
            <SidebarFooter />
          </aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
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
          <div className="ml-auto flex items-center gap-3">
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
        <main className="scrollbar-ghost min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
