"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PerfilForm } from "@/components/PerfilForm";
import { TeepLogo } from "@/components/TeepLogo";
import { api, logoutSession, getStoredUser, patchStoredUser, setSession, User } from "@/lib/api";
import { homeForUser } from "@/lib/access";

export default function TrocarSenhaPage() {
  const router = useRouter();
  const [step, setStep] = useState<"senha" | "perfil">("senha");
  const [senhaNova, setSenhaNova] = useState("");
  const [senhaNovaConfirmacao, setSenhaNovaConfirmacao] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const u = getStoredUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    setUser(u);
    if (!u.deveTrocarSenha && u.perfilCompleto === false) {
      setStep("perfil");
    }
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api<{
        accessToken: string;
        user: User;
      }>("/auth/trocar-senha", {
        method: "POST",
        body: JSON.stringify({
          senhaNova,
          senhaNovaConfirmacao,
        }),
      });
      setSession(data);
      setUser(data.user);
      if (data.user.perfilCompleto === false) {
        setStep("perfil");
        return;
      }
      router.replace(homeForUser(data.user));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao trocar senha");
    } finally {
      setLoading(false);
    }
  }

  async function sair() {
    await logoutSession();
    router.replace("/login");
  }

  if (!user) return null;

  if (step === "perfil") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-light to-slate-100 px-4 py-10">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex justify-center">
              <TeepLogo variant="full" height={44} priority />
            </div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-brand">
              Passo 2 de 2
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">
              Finalize seu cadastro
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Senha definida. Agora confirme seus dados e como quer aparecer na
              plataforma.
            </p>
          </div>
          <PerfilForm
            completar
            initial={{
              nome: user.nome,
              apelido: user.apelido || "",
              telefone: user.telefone || "",
              dataNascimento: user.dataNascimento || "",
              fotoPerfil: user.fotoPerfil || null,
            }}
            onSaved={(me) => {
              patchStoredUser(me);
              router.replace(homeForUser(me));
            }}
          />
          <button
            type="button"
            onClick={sair}
            className="mt-4 w-full rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-light to-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex justify-center">
            <TeepLogo variant="full" height={44} priority />
          </div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-brand">
            Passo 1 de 2
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Definir nova senha
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Olá, {user.nome}. Por segurança, troque a senha provisória antes de
            continuar.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
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
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand py-3 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {loading ? "Salvando…" : "Continuar"}
          </button>
          <button
            type="button"
            onClick={sair}
            className="w-full rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Sair
          </button>
        </form>
      </div>
    </div>
  );
}
