"use client";

import { api } from "@/lib/api";
import { FormEvent, useEffect, useState } from "react";

type Categoria = {
  id: string;
  nome: string;
  descricao?: string | null;
  ativo: boolean;
};

const emptyForm = { nome: "", descricao: "" };

export default function CategoriasPage() {
  const [lista, setLista] = useState<Categoria[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setLista(await api<Categoria[]>("/categorias?ativas=0"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function cancelEdit() {
    setEditId(null);
    setForm(emptyForm);
  }

  function startEdit(c: Categoria) {
    setEditId(c.id);
    setForm({ nome: c.nome, descricao: c.descricao || "" });
    setError("");
    setMsg("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
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
        setMsg("Categoria atualizada");
      } else {
        await api("/categorias", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setMsg("Categoria cadastrada");
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  async function toggleAtivo(c: Categoria) {
    setError("");
    try {
      await api(`/categorias/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !c.ativo }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  return (
    <>
    <h1 className="text-2xl font-semibold">Categorias</h1>
      <p className="mt-1 text-sm text-slate-500">
        Cadastre, edite e ative/desative categorias de produto.
      </p>

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
        {msg && (
          <p className="text-sm text-emerald-700 sm:col-span-2">{msg}</p>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-white"
          >
            {editId ? "Salvar alterações" : "Cadastrar"}
          </button>
          {editId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg border px-4 py-2 text-slate-600"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <ul className="mt-6 divide-y rounded-xl border bg-white">
        {lista.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-slate-500">
            Nenhuma categoria cadastrada.
          </li>
        )}
        {lista.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
          >
            <div>
              <div className="font-medium">{c.nome}</div>
              {c.descricao && (
                <div className="text-xs text-slate-500">{c.descricao}</div>
              )}
              <div className="text-xs text-slate-400">
                {c.ativo ? "Ativa" : "Inativa"}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => startEdit(c)}
                className="text-brand hover:underline"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => toggleAtivo(c)}
                className="text-brand hover:underline"
              >
                {c.ativo ? "Desativar" : "Ativar"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
