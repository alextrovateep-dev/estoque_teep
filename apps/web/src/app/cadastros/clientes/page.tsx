"use client";

import { api, getStoredUser } from "@/lib/api";
import { userCanEditCadastro } from "@/lib/access";
import { matchNomeOuDocumento } from "@/lib/documento";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

type Cliente = {
  id: string;
  nome: string;
  nomeFantasia?: string | null;
  tipo: string;
  documento?: string | null;
  email?: string | null;
  telefone?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  ativo: boolean;
};

type ResumoItem = {
  clienteId: string;
  comprados: number;
  vendidos: number;
};

type ProdutoRel = {
  produtoId: string;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidadeTotal: number;
  ultimaData: string;
  movimentos: number;
  controlaSerie?: boolean;
  series?: string[];
};

type Relacionamentos = {
  clienteId: string;
  comprados: ProdutoRel[];
  vendidos: ProdutoRel[];
};

function formatData(iso: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatQty(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 4,
  }).format(n);
}

export default function ClientesPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-slate-500">Carregando…</p>}
    >
      <ClientesPageInner />
    </Suspense>
  );
}

function ClientesPageInner() {
  const searchParams = useSearchParams();
  const canEdit = (() => {
    const u = getStoredUser();
    return u ? userCanEditCadastro(u, "clientes") : false;
  })();
  const [lista, setLista] = useState<Cliente[]>([]);
  const [resumo, setResumo] = useState<Record<string, ResumoItem>>({});
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [expandidoId, setExpandidoId] = useState<string | null>(null);
  const [relCache, setRelCache] = useState<Record<string, Relacionamentos>>({});
  const [loadingRel, setLoadingRel] = useState<string | null>(null);

  async function load() {
    const [clientes, resumos] = await Promise.all([
      api<Cliente[]>("/clientes?ativas=0"),
      api<ResumoItem[]>("/clientes/relacionamentos-resumo"),
    ]);
    setLista(clientes);
    const map: Record<string, ResumoItem> = {};
    for (const r of resumos) map[r.clienteId] = r;
    setResumo(map);
    setRelCache({});
    setExpandidoId(null);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const ok = searchParams.get("ok");
    if (ok === "criado") setMsg("Cadastro criado");
    else if (ok === "atualizado") setMsg("Cadastro atualizado");
  }, [searchParams]);

  const filtrados = useMemo(() => {
    const q = busca.trim();
    return lista.filter((c) => {
      if (filtroTipo && c.tipo !== filtroTipo) return false;
      if (!q) return true;
      if (matchNomeOuDocumento(c.nome, c.documento, q)) return true;
      if ((c.nomeFantasia || "").toLowerCase().includes(q.toLowerCase())) {
        return true;
      }
      return c.tipo.toLowerCase().includes(q.toLowerCase());
    });
  }, [lista, busca, filtroTipo]);

  async function toggleAtivo(c: Cliente) {
    setError("");
    try {
      await api(`/clientes/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !c.ativo }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  async function toggleExpand(c: Cliente) {
    if (expandidoId === c.id) {
      setExpandidoId(null);
      return;
    }
    const id = c.id;
    setExpandidoId(id);
    if (relCache[id]) return;
    setLoadingRel(id);
    try {
      const rel = await api<Relacionamentos>(`/clientes/${id}/relacionamentos`);
      setRelCache((prev) => ({ ...prev, [id]: rel }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar histórico");
      setExpandidoId((cur) => (cur === id ? null : cur));
    } finally {
      setLoadingRel((cur) => (cur === id ? null : cur));
    }
  }

  function temHistorico(id: string) {
    const r = resumo[id];
    return !!r && r.comprados + r.vendidos > 0;
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Clientes / Fornecedores</h1>
          <p className="mt-1 text-sm text-slate-500">
            Lista e histórico de produtos por cadastro.
          </p>
        </div>
        {canEdit && (
          <Link
            href="/cadastros/clientes/novo"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
          >
            Cadastrar
          </Link>
        )}
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

      <div className="mt-4 flex flex-col gap-2 rounded-xl border bg-white p-4 sm:flex-row">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, CNPJ ou tipo…"
          className="flex-1 rounded-lg border px-3 py-2"
          autoComplete="off"
        />
        <select
          className="rounded-lg border px-3 py-2 sm:w-44"
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
        >
          <option value="">Todos os tipos</option>
          <option value="CLIENTE">CLIENTE</option>
          <option value="FORNECEDOR">FORNECEDOR</option>
          <option value="INTERNO">INTERNO</option>
        </select>
      </div>

      <ul className="mt-3 divide-y rounded-xl border bg-white">
        {filtrados.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-slate-500">
            {lista.length === 0
              ? "Nenhum cadastro ainda."
              : "Nenhum resultado para a busca."}
          </li>
        )}
        {filtrados.map((c) => {
          const r = resumo[c.id];
          const aberto = expandidoId === c.id;
          const rel = relCache[c.id];
          const hist = temHistorico(c.id);
          const outroAberto = expandidoId !== null && !aberto;
          return (
            <li
              key={c.id}
              className={
                aberto
                  ? "border-l-4 border-l-brand bg-brand/[0.07] text-sm shadow-[inset_0_0_0_1px_rgba(91,139,131,0.22)]"
                  : outroAberto
                    ? "text-sm opacity-45"
                    : "text-sm"
              }
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-start gap-2">
                  {hist ? (
                    <button
                      type="button"
                      onClick={() => void toggleExpand(c)}
                      className={
                        aberto
                          ? "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-brand/40 bg-brand/15 text-brand"
                          : "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 text-brand hover:bg-slate-50"
                      }
                      title={
                        aberto
                          ? "Recolher histórico de produtos"
                          : "Ver produtos do histórico"
                      }
                      aria-expanded={aberto}
                      aria-label={
                        aberto
                          ? "Recolher histórico"
                          : "Expandir histórico de produtos"
                      }
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className={`h-4 w-4 transition-transform ${aberto ? "rotate-90" : ""}`}
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  ) : (
                    <span className="mt-0.5 inline-block h-7 w-7 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <span
                      className={
                        aberto ? "font-semibold text-slate-900" : "font-medium"
                      }
                    >
                      {c.nome}
                    </span>
                    <span className="ml-2 text-slate-500">
                      {c.tipo}
                      {c.documento ? ` · ${c.documento}` : ""} ·{" "}
                      {c.ativo ? "Ativo" : "Inativo"}
                    </span>
                    {(c.cidade || c.estado) && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {[c.cidade, c.estado].filter(Boolean).join(" / ")}
                        {c.email ? ` · ${c.email}` : ""}
                      </p>
                    )}
                    {hist && r && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {r.comprados > 0 && (
                          <span>
                            {r.comprados} comprado{r.comprados === 1 ? "" : "s"}
                          </span>
                        )}
                        {r.comprados > 0 && r.vendidos > 0 && " · "}
                        {r.vendidos > 0 && (
                          <span>
                            {r.vendidos} vendido{r.vendidos === 1 ? "" : "s"}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-3">
                  <Link
                    href={`/cadastros/clientes/${c.id}`}
                    className="text-brand hover:underline"
                  >
                    {canEdit ? "Editar" : "Ver"}
                  </Link>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => toggleAtivo(c)}
                      className="text-brand hover:underline"
                    >
                      {c.ativo ? "Desativar" : "Ativar"}
                    </button>
                  )}
                </div>
              </div>

              {aberto && (
                <div className="border-t border-brand/20 bg-white/70 px-4 py-4 pl-14">
                  {loadingRel === c.id && !rel && (
                    <p className="text-xs text-slate-400">Carregando…</p>
                  )}
                  {rel && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <RelacoesProdutos
                        titulo="Compramos deles (entrada)"
                        itens={rel.comprados}
                        vazio="Nenhuma compra registrada."
                      />
                      <RelacoesProdutos
                        titulo="Vendemos / enviamos (saída)"
                        itens={rel.vendidos}
                        vazio="Nenhuma venda/envio registrado."
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {lista.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Exibindo {filtrados.length} de {lista.length}
        </p>
      )}
    </>
  );
}

function RelacoesProdutos({
  titulo,
  itens,
  vazio,
}: {
  titulo: string;
  itens: ProdutoRel[];
  vazio: string;
}) {
  return (
    <div className="rounded-lg border border-brand/20 bg-white p-3 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-brand">
        {titulo}
      </h3>
      {itens.length === 0 ? (
        <p className="mt-1 text-xs text-slate-400">{vazio}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {itens.map((p) => (
            <li
              key={p.produtoId}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs text-slate-700">
                  {p.codigo}
                </span>
                {p.controlaSerie || (p.series && p.series.length > 0) ? (
                  <span className="rounded bg-teal-50 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-800">
                    Série
                  </span>
                ) : null}
              </div>
              <div className="font-medium text-slate-900">{p.descricao}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {formatQty(p.quantidadeTotal)} {p.unidade} · {p.movimentos}{" "}
                mov. · últ. {formatData(p.ultimaData)}
              </div>
              {p.series && p.series.length > 0 ? (
                <div className="mt-1.5 border-t border-slate-200/80 pt-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Números de série ({p.series.length})
                  </p>
                  <p className="mt-0.5 break-words font-mono text-[11px] leading-relaxed text-teal-900">
                    {p.series.join(" · ")}
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
