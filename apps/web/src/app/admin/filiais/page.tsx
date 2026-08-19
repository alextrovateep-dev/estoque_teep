"use client";

import { api, getStoredUser, User } from "@/lib/api";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

type Filial = {
  id: string;
  nome: string;
  sigla: string;
  cidade?: string | null;
  estado?: string | null;
  ativo: boolean;
  estoqueAcabados?: boolean;
};

function localLabel(f: Filial): string | null {
  const cidade = f.cidade?.trim();
  const uf = f.estado?.trim();
  if (cidade && uf) return `${cidade}/${uf}`;
  if (cidade) return cidade;
  if (uf) return uf;
  return null;
}

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

export default function FiliaisPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-slate-500">Carregando…</p>}
    >
      <FiliaisPageInner />
    </Suspense>
  );
}

function FiliaisPageInner() {
  const searchParams = useSearchParams();
  const [setup, setSetup] = useState(false);
  const [lista, setLista] = useState<Filial[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setLista(await api<Filial[]>("/filiais?ativas=0"));
  }

  useEffect(() => {
    setSetup(searchParams.get("setup") === "1");
    const ok = searchParams.get("ok");
    if (ok === "criado") setMsg("Estoque cadastrado");
    else if (ok === "atualizado") setMsg("Estoque atualizado");
    load().catch((e) =>
      setError(e instanceof Error ? e.message : "Erro ao carregar")
    );
  }, [searchParams]);

  async function toggleAtivo(f: Filial) {
    setError("");
    setMsg("");
    try {
      await api(`/filiais/${f.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !f.ativo }),
      });
      await load();
      await refreshTemEstoque();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("teep-user-updated"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Estoques</h1>
          <p className="mt-1 text-sm text-slate-500">
            Locais de estoque. A sigla aparece nos lançamentos e no dashboard.
          </p>
        </div>
        <Link
          href="/admin/filiais/novo"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          Adicionar estoque
        </Link>
      </div>

      {(setup || lista.length === 0) && (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <p className="font-medium">Primeiro passo da instalação</p>
          <p className="mt-1 text-sky-900/90">
            Crie ao menos um estoque (ex.: matriz, filial, RMA, descarte). Você
            pode navegar no menu, mas lançamentos e RMA só liberam depois deste
            cadastro.
          </p>
        </div>
      )}

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

      <ul className="mt-6 space-y-2">
        {lista.length === 0 && (
          <li className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
            Nenhum estoque cadastrado.
          </li>
        )}
        {lista.map((f) => {
          const local = localLabel(f);
          return (
            <li
              key={f.id}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
            >
              <div>
                <div className="font-medium">
                  <span className="font-mono text-sm text-slate-700">
                    {f.sigla}
                  </span>
                  <span className="text-slate-400"> — </span>
                  {f.nome}
                </div>
                <div className="text-xs text-slate-500">
                  {local ? `${local} · ` : null}
                  {f.ativo ? "Ativo" : "Inativo"}
                  {f.estoqueAcabados ? " · Acabados" : ""}
                </div>
              </div>
              <div className="flex gap-3 text-sm">
                <Link
                  href={`/admin/filiais/${f.id}`}
                  className="text-brand hover:underline"
                >
                  Editar
                </Link>
                <button
                  type="button"
                  onClick={() => toggleAtivo(f)}
                  className="text-brand hover:underline"
                >
                  {f.ativo ? "Desativar" : "Ativar"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
