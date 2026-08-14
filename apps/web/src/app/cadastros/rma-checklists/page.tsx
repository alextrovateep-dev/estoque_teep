"use client";

import { api, getStoredUser } from "@/lib/api";
import { userHas } from "@/lib/access";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  ChecklistTemplate,
  TIPO_HINT,
} from "@/components/rma/rmaChecklistShared";

export default function RmaChecklistsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Carregando…</p>}>
      <RmaChecklistsInner />
    </Suspense>
  );
}

function RmaChecklistsInner() {
  const user = getStoredUser();
  const can = user ? userHas(user, "rma") : false;
  const searchParams = useSearchParams();

  const [lista, setLista] = useState<ChecklistTemplate[]>([]);
  const [q, setQ] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<
    "" | "RECEBIMENTO" | "LIBERACAO"
  >("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const t = await api<ChecklistTemplate[]>("/rma/checklists");
    setLista(t);
  }

  useEffect(() => {
    const ok = searchParams.get("ok");
    if (ok === "salvo") setMsg("Checklist salvo.");
    else if (ok === "copiado") setMsg("Checklist copiado.");
    load().catch((e) =>
      setError(e instanceof Error ? e.message : "Erro ao carregar")
    );
  }, [searchParams]);

  const filtrados = useMemo(() => {
    const term = q.trim().toLowerCase();
    return lista
      .filter((t) => (filtroTipo ? t.tipo === filtroTipo : true))
      .filter((t) => {
        if (!term) return true;
        return (
          t.produto.codigo.toLowerCase().includes(term) ||
          t.produto.descricao.toLowerCase().includes(term) ||
          t.nome.toLowerCase().includes(term)
        );
      })
      .slice()
      .sort((a, b) => {
        const byCod = a.produto.codigo.localeCompare(b.produto.codigo, "pt-BR");
        if (byCod !== 0) return byCod;
        return String(a.tipo).localeCompare(String(b.tipo));
      });
  }, [lista, q, filtroTipo]);

  if (!can) {
    return (
      <p className="text-sm text-slate-600">Sem permissão para checklists RMA.</p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Checklists RMA
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Defina as perguntas da entrada e da liberação por produto.
          </p>
        </div>
        <Link
          href="/rma"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          ← Processos RMA
        </Link>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {msg ? (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <CriarCard
          href="/cadastros/rma-checklists/novo/RECEBIMENTO"
          titulo="Criar checklist de entrada"
          descricao="Perguntas na chegada do equipamento (recebimento)."
          accent="sky"
        />
        <CriarCard
          href="/cadastros/rma-checklists/novo/LIBERACAO"
          titulo="Criar checklist de liberação"
          descricao="Perguntas antes de devolver ou trocar (envio)."
          accent="violet"
        />
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Checklists cadastrados
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Clique para editar. Só aparecem os que já foram criados.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="Buscar produto…"
              className="w-full min-w-[12rem] rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 sm:w-56"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
              value={filtroTipo}
              onChange={(e) =>
                setFiltroTipo(
                  e.target.value as "" | "RECEBIMENTO" | "LIBERACAO"
                )
              }
            >
              <option value="">Todos</option>
              <option value="RECEBIMENTO">Entrada</option>
              <option value="LIBERACAO">Liberação</option>
            </select>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Produto</th>
                <th className="px-3 py-2.5 font-medium">Tipo</th>
                <th className="px-3 py-2.5 font-medium">Perguntas</th>
                <th className="px-3 py-2.5 font-medium">Versão</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtrados.map((t) => {
                const tipo =
                  t.tipo === "LIBERACAO" ? "LIBERACAO" : "RECEBIMENTO";
                return (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-3 py-3">
                      <div className="font-mono text-xs font-semibold text-slate-800">
                        {t.produto.codigo}
                      </div>
                      <div className="mt-0.5 text-slate-600">
                        {t.produto.descricao}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          tipo === "RECEBIMENTO"
                            ? "bg-sky-50 text-sky-800"
                            : "bg-violet-50 text-violet-800"
                        }`}
                      >
                        {tipo === "RECEBIMENTO" ? "Entrada" : "Liberação"}
                      </span>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {TIPO_HINT[tipo]}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {t.itens.length}
                    </td>
                    <td className="px-3 py-3 text-slate-500">v{t.versao}</td>
                    <td className="px-3 py-3 text-right">
                      <Link
                        href={`/cadastros/rma-checklists/${t.produto.id}/${tipo}`}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-800 hover:border-brand/40 hover:bg-brand/5"
                      >
                        Editar
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-12 text-center text-sm text-slate-400"
                  >
                    {lista.length === 0
                      ? "Nenhum checklist ainda. Use os cards acima para criar o primeiro."
                      : "Nenhum checklist encontrado com esse filtro."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {filtrados.length} checklist{filtrados.length === 1 ? "" : "s"}
        </p>
      </div>
    </>
  );
}

function CriarCard({
  href,
  titulo,
  descricao,
  accent,
}: {
  href: string;
  titulo: string;
  descricao: string;
  accent: "sky" | "violet";
}) {
  const styles =
    accent === "sky"
      ? "border-sky-200 bg-sky-50/50 hover:border-sky-300 hover:bg-sky-50"
      : "border-violet-200 bg-violet-50/50 hover:border-violet-300 hover:bg-violet-50";
  const cta = accent === "sky" ? "text-sky-800" : "text-violet-800";

  return (
    <Link
      href={href}
      className={`block rounded-xl border px-5 py-5 shadow-sm transition ${styles}`}
    >
      <p className="text-base font-semibold text-slate-900">{titulo}</p>
      <p className="mt-1 text-sm text-slate-600">{descricao}</p>
      <p className={`mt-3 text-sm font-medium ${cta}`}>Começar →</p>
    </Link>
  );
}
