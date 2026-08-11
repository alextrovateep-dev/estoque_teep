"use client";

import { api } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type Categoria = {
  id: string;
  nome: string;
  descricao?: string | null;
  ativo: boolean;
};

const emptyForm = { nome: "", descricao: "" };

export function CategoriaCadastroForm({ categoriaId }: { categoriaId?: string }) {
  const router = useRouter();
  const editId = categoriaId || null;
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(editId));
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setError("");
    api<Categoria>(`/categorias/${editId}`)
      .then((c) => {
        if (cancelled) return;
        setForm({ nome: c.nome, descricao: c.descricao || "" });
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadFailed(true);
        setError(e instanceof Error ? e.message : "Categoria não encontrada");
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
    try {
      const body = {
        nome: form.nome.trim(),
        descricao: form.descricao.trim() || null,
      };
      if (editId) {
        await api(`/categorias/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        router.push("/admin/categorias?ok=atualizado");
      } else {
        await api("/categorias", {
          method: "POST",
          body: JSON.stringify(body),
        });
        router.push("/admin/categorias?ok=criado");
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
          <h1 className="text-2xl font-semibold">Editar categoria</h1>
          <Link
            href="/admin/categorias"
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
          >
            Voltar à lista
          </Link>
        </div>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error || "Categoria não encontrada"}
        </p>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {editId ? "Editar categoria" : "Nova categoria"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Categorias de produto.
          </p>
        </div>
        <Link
          href="/admin/categorias"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          Voltar à lista
        </Link>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-4 grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-2"
      >
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">Nome</span>
          <input
            required
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder="Nome da categoria"
            className="w-full rounded-lg border px-3 py-2"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">Descrição</span>
          <input
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            placeholder="Opcional"
            className="w-full rounded-lg border px-3 py-2"
          />
        </label>
        {error && (
          <p className="text-sm text-red-600 sm:col-span-2">{error}</p>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-white"
          >
            {editId ? "Salvar alterações" : "Cadastrar"}
          </button>
          <Link
            href="/admin/categorias"
            className="rounded-lg border px-4 py-2 text-slate-600"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </>
  );
}
