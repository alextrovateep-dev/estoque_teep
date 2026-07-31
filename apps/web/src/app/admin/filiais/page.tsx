"use client";

import { api } from "@/lib/api";
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

export default function FiliaisPage() {
  const [lista, setLista] = useState<Filial[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  async function load() {
    setLista(await api<Filial[]>("/filiais?ativas=0"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function cancelEdit() {
    setEditId(null);
    setForm(emptyForm);
  }

  function startEdit(f: Filial) {
    setEditId(f.id);
    setForm({
      nome: f.nome,
      sigla: f.sigla,
      cidade: f.cidade || "",
      estado: f.estado || "",
    });
    setError("");
    setMsg("");
  }

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
        setMsg("Filial atualizada");
      } else {
        await api("/filiais", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setMsg("Filial cadastrada");
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  async function toggleAtivo(f: Filial) {
    setError("");
    try {
      await api(`/filiais/${f.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !f.ativo }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  return (
    <>
    <h1 className="text-2xl font-semibold">Filiais</h1>
      <form
        onSubmit={onSubmit}
        className="mt-6 grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2"
      >
        <input
          required
          placeholder="Nome"
          className="rounded-lg border px-3 py-2"
          value={form.nome}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
        />
        <input
          required
          maxLength={5}
          placeholder="Sigla"
          className="rounded-lg border px-3 py-2"
          value={form.sigla}
          onChange={(e) => setForm({ ...form, sigla: e.target.value })}
        />
        <input
          placeholder="Cidade"
          className="rounded-lg border px-3 py-2"
          value={form.cidade}
          onChange={(e) => setForm({ ...form, cidade: e.target.value })}
        />
        <input
          placeholder="UF"
          maxLength={2}
          className="rounded-lg border px-3 py-2"
          value={form.estado}
          onChange={(e) => setForm({ ...form, estado: e.target.value })}
        />
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        {msg && (
          <p className="text-sm text-emerald-700 sm:col-span-2">{msg}</p>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-white"
          >
            {editId ? "Salvar alterações" : "Adicionar filial"}
          </button>
          {editId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg border px-4 py-2"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>
      <ul className="mt-6 space-y-2">
        {lista.map((f) => (
          <li
            key={f.id}
            className="flex items-center justify-between rounded-xl border bg-white px-4 py-3"
          >
            <div>
              <div className="font-medium">
                {f.sigla} — {f.nome}
              </div>
              <div className="text-xs text-slate-500">
                {f.cidade}/{f.estado} · {f.ativo ? "Ativa" : "Inativa"}
              </div>
            </div>
            <div className="flex gap-3 text-sm">
              <button
                type="button"
                onClick={() => startEdit(f)}
                className="text-brand hover:underline"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => toggleAtivo(f)}
                className="text-brand hover:underline"
              >
                {f.ativo ? "Desativar" : "Ativar"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
