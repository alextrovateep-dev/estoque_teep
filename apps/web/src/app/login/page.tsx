"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setSession, User } from "@/lib/api";
import { homeForUser } from "@/lib/access";
import { TeepLogo } from "@/components/TeepLogo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@teep.com.br");
  const [senha, setSenha] = useState("Admin@123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api<{
        accessToken: string;
        refreshToken: string;
        user: User;
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, senha }),
      });
      setSession(data);
      if (data.user.deveTrocarSenha) {
        router.replace("/trocar-senha");
        return;
      }
      if (data.user.perfilCompleto === false) {
        router.replace("/perfil?completar=1");
        return;
      }
      router.replace(homeForUser(data.user));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-light to-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex justify-center">
            <TeepLogo variant="full" height={44} priority />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Estoque</h1>
          <p className="mt-1 text-sm text-slate-500">
            Entre com seu usuário e senha
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">E-mail</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Senha</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
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
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
      <p className="mt-6 text-xs text-slate-400">estoque.teep.com.br</p>
    </div>
  );
}
