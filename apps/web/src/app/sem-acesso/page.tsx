"use client";

import { clearSession, getStoredUser } from "@/lib/api";
import { userHasAnyOpsAccess } from "@/lib/access";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Escape hatch quando o Admin zerou todas as permissões do usuário. */
export default function SemAcessoPage() {
  const router = useRouter();
  const [nome, setNome] = useState("");

  useEffect(() => {
    const u = getStoredUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    if (u.deveTrocarSenha) {
      router.replace("/trocar-senha");
      return;
    }
    if (userHasAnyOpsAccess(u)) {
      router.replace("/");
      return;
    }
    setNome(u.nome);
  }, [router]);

  function sair() {
    clearSession();
    router.replace("/login");
  }

  if (!nome) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Carregando…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-light to-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Sem acesso</h1>
        <p className="mt-3 text-sm text-slate-600">
          Olá, {nome}. Sua conta está ativa, mas nenhuma tela foi liberada.
          Peça ao administrador para ajustar as permissões em Usuários e Perfis.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={sair}
            className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark"
          >
            Sair
          </button>
          <Link
            href="/login"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Trocar de conta
          </Link>
        </div>
      </div>
    </div>
  );
}
