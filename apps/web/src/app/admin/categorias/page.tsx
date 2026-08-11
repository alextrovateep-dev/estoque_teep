"use client";

import { api } from "@/lib/api";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

type Categoria = {
  id: string;
  nome: string;
  descricao?: string | null;
  ativo: boolean;
};

export default function CategoriasPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-slate-500">Carregando…</p>}
    >
      <CategoriasPageInner />
    </Suspense>
  );
}

function CategoriasPageInner() {
  const searchParams = useSearchParams();
  const [lista, setLista] = useState<Categoria[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setLista(await api<Categoria[]>("/categorias?ativas=0"));
  }

  useEffect(() => {
    const ok = searchParams.get("ok");
    if (ok === "criado") setMsg("Categoria cadastrada");
    else if (ok === "atualizado") setMsg("Categoria atualizada");
    load().catch((e) => setError(e.message));
  }, [searchParams]);

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Categorias</h1>
          <p className="mt-1 text-sm text-slate-500">
            Cadastre, edite e ative/desative categorias de produto.
          </p>
        </div>
        <Link
          href="/admin/categorias/novo"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          Cadastrar
        </Link>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {msg && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      )}

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
              <Link
                href={`/admin/categorias/${c.id}`}
                className="text-brand hover:underline"
              >
                Editar
              </Link>
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
