"use client";

import { api, getStoredUser, User } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type Filial = {
  id: string;
  nome: string;
  sigla: string;
  cidade?: string | null;
  estado?: string | null;
  ativo: boolean;
};

const emptyForm = {
  nome: "",
  sigla: "",
  cidade: "",
  estado: "",
};

async function refreshTemEstoque() {
  try {
    const me = await api<User>("/auth/me");
    const cur = getStoredUser();
    if (!cur) return;
    localStorage.setItem(
      "teep_user",
      JSON.stringify({ ...cur, temEstoque: me.temEstoque })
    );
  } catch {
    /* ignore */
  }
}

export function FilialCadastroForm({ filialId }: { filialId?: string }) {
  const router = useRouter();
  const editId = filialId || null;
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(Boolean(editId));
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setError("");
    api<Filial>(`/filiais/${editId}`)
      .then((f) => {
        if (cancelled) return;
        setForm({
          nome: f.nome,
          sigla: f.sigla,
          cidade: f.cidade || "",
          estado: f.estado || "",
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadFailed(true);
        setError(e instanceof Error ? e.message : "Estoque não encontrado");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    const body = {
      nome: form.nome.trim(),
      sigla: form.sigla.toUpperCase().trim(),
      cidade: form.cidade.trim() || null,
      estado: form.estado ? form.estado.toUpperCase().trim() : null,
    };
    try {
      if (editId) {
        await api(`/filiais/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        await refreshTemEstoque();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("teep-user-updated"));
        }
        router.push("/admin/filiais?ok=atualizado");
      } else {
        await api("/filiais", {
          method: "POST",
          body: JSON.stringify(body),
        });
        await refreshTemEstoque();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("teep-user-updated"));
        }
        router.push("/admin/filiais?ok=criado");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  if (loading) {
    return <p className="mt-4 text-sm text-slate-500">Carregando…</p>;
  }

  if (loadFailed) {
    return (
      <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold">Editar estoque</h1>
          <Link
            href="/admin/filiais"
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
          >
            Voltar à lista
          </Link>
        </div>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error || "Estoque não encontrado"}
        </p>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {editId ? "Editar estoque" : "Adicionar estoque"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            A sigla aparece nos lançamentos e no dashboard.
          </p>
        </div>
        <Link
          href="/admin/filiais"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          Voltar à lista
        </Link>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Nome</span>
          <input
            required
            placeholder="Ex.: Paulínia"
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Sigla</span>
          <input
            required
            maxLength={5}
            placeholder="Ex.: PLN"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 uppercase"
            value={form.sigla}
            onChange={(e) => setForm({ ...form, sigla: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Cidade</span>
          <input
            placeholder="Opcional"
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            value={form.cidade}
            onChange={(e) => setForm({ ...form, cidade: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">UF</span>
          <input
            placeholder="Ex.: SP"
            maxLength={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 uppercase"
            value={form.estado}
            onChange={(e) => setForm({ ...form, estado: e.target.value })}
          />
        </label>
        {error && (
          <p className="text-sm text-red-600 sm:col-span-2">{error}</p>
        )}
        {msg && (
          <p className="text-sm text-emerald-700 sm:col-span-2">{msg}</p>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
          >
            {editId ? "Salvar alterações" : "Adicionar estoque"}
          </button>
          <Link
            href="/admin/filiais"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </>
  );
}
