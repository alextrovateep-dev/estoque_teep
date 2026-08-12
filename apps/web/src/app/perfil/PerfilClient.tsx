"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PerfilForm } from "@/components/PerfilForm";
import {
  api,
  getStoredUser,
  patchStoredUser,
  setSession,
  User,
} from "@/lib/api";
import { homeForUser } from "@/lib/access";

export default function PerfilClient() {
  const router = useRouter();
  const search = useSearchParams();
  const completar = search.get("completar") === "1";
  const [user, setUser] = useState<User | null>(null);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [senhaNovaConfirmacao, setSenhaNovaConfirmacao] = useState("");
  const [senhaError, setSenhaError] = useState("");
  const [senhaMsg, setSenhaMsg] = useState("");
  const [senhaLoading, setSenhaLoading] = useState(false);

  useEffect(() => {
    const u = getStoredUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    void api<User>("/auth/me")
      .then((me) => {
        patchStoredUser(me);
        setUser({ ...u, ...me });
      })
      .catch(() => setUser(u));
  }, [router]);

  async function onTrocarSenha(e: FormEvent) {
    e.preventDefault();
    setSenhaError("");
    setSenhaMsg("");
    setSenhaLoading(true);
    try {
      const data = await api<{
        accessToken: string;
        user: User;
      }>("/auth/trocar-senha", {
        method: "POST",
        body: JSON.stringify({
          senhaAtual,
          senhaNova,
          senhaNovaConfirmacao,
        }),
      });
      setSession(data);
      setUser((prev) => (prev ? { ...prev, ...data.user } : data.user));
      setSenhaAtual("");
      setSenhaNova("");
      setSenhaNovaConfirmacao("");
      setSenhaMsg("Senha alterada com sucesso");
    } catch (err) {
      setSenhaError(
        err instanceof Error ? err.message : "Falha ao trocar senha"
      );
    } finally {
      setSenhaLoading(false);
    }
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Carregando…
      </div>
    );
  }

  const needsComplete = completar || user.perfilCompleto === false;

  const form = (
    <PerfilForm
      completar={needsComplete}
      initial={{
        nome: user.nome,
        apelido: user.apelido || "",
        telefone: user.telefone || "",
        dataNascimento: user.dataNascimento || "",
        fotoPerfil: user.fotoPerfil || null,
      }}
      onSaved={(me) => {
        setUser((prev) => (prev ? { ...prev, ...me } : me));
        if (needsComplete && me.perfilCompleto) {
          router.replace(homeForUser(me));
        }
      }}
    />
  );

  if (needsComplete) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-light to-slate-100 px-4 py-10">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-brand text-xl font-bold text-white">
              T
            </div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Finalize seu cadastro
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Confirme seus dados e escolha como quer aparecer na plataforma.
            </p>
          </div>
          {form}
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="mx-auto max-w-xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Meu perfil</h1>
          <p className="mt-1 text-sm text-slate-500">
            Foto, dados pessoais e senha. E-mail: {user.email}
          </p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Dados pessoais
          </h2>
          {form}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Alterar senha
          </h2>
          <form onSubmit={onTrocarSenha} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Senha atual</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Nova senha</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={senhaNova}
                onChange={(e) => setSenhaNova(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Mín. 8 caracteres, 1 maiúscula e 1 número
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                Confirmar nova senha
              </span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={senhaNovaConfirmacao}
                onChange={(e) => setSenhaNovaConfirmacao(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </label>
            {senhaError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {senhaError}
              </p>
            )}
            {senhaMsg && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {senhaMsg}
              </p>
            )}
            <button
              type="submit"
              disabled={senhaLoading}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {senhaLoading ? "Salvando…" : "Alterar senha"}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
