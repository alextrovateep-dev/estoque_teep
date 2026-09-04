"use client";

import { api, getStoredUser } from "@/lib/api";
import { ImageLightbox } from "@/components/ImageLightbox";
import { userCanEditCadastro } from "@/lib/access";
import { formatMoney } from "@/lib/money";
import { resolveAssetUrl } from "@/lib/assets";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";

type FotoLightbox = {
  images: string[];
  initialIndex: number;
  titulo: string;
  codigo: string;
};

type Categoria = { id: string; nome: string; ativo: boolean };
type Produto = {
  id: string;
  codigo: string;
  descricao: string;
  precoUnitario: string | number;
  estoqueMinimo: number;
  estoqueMaximo: number;
  unidade?: string;
  controlaSerie?: boolean;
  categoriaId?: string;
  ativo: boolean;
  fotos?: string[] | unknown;
  categoria: Categoria;
};

type ResumoProduto = {
  produtoId: string;
  fornecedores: number;
  clientes: number;
};

type ParceiroRel = {
  clienteId: string;
  nome: string;
  tipo: string;
  quantidadeTotal: number;
  ultimaData: string;
  movimentos: number;
};

type RelProduto = {
  produtoId: string;
  fornecedores: ParceiroRel[];
  clientes: ParceiroRel[];
};

function asFotos(raw: unknown): string[] {
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function fotosResolvidas(raw: unknown): string[] {
  return asFotos(raw)
    .map((f) => resolveAssetUrl(f))
    .filter((u): u is string => Boolean(u));
}

function formatData(iso: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
      new Date(iso)
    );
  } catch {
    return iso;
  }
}

function formatQty(n: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(n);
}

export default function ProdutosPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-slate-500">Carregando…</p>}
    >
      <ProdutosPageInner />
    </Suspense>
  );
}

function ProdutosPageInner() {
  const searchParams = useSearchParams();
  const canEdit = (() => {
    const u = getStoredUser();
    return u ? userCanEditCadastro(u, "produtos") : false;
  })();
  const isAdmin = getStoredUser()?.perfil === "ADMIN";
  const [lista, setLista] = useState<Produto[]>([]);
  const [busca, setBusca] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [resumo, setResumo] = useState<Record<string, ResumoProduto>>({});
  const [expandidoId, setExpandidoId] = useState<string | null>(null);
  const [relCache, setRelCache] = useState<Record<string, RelProduto>>({});
  const [loadingRel, setLoadingRel] = useState<string | null>(null);
  const [fotoLightbox, setFotoLightbox] = useState<FotoLightbox | null>(null);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);

  async function load() {
    const [p, resumos] = await Promise.all([
      api<Produto[]>("/produtos?ativas=0"),
      api<ResumoProduto[]>("/produtos/relacionamentos-resumo"),
    ]);
    setLista(p);
    const map: Record<string, ResumoProduto> = {};
    for (const r of resumos) map[r.produtoId] = r;
    setResumo(map);
    setRelCache({});
    setExpandidoId(null);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const ok = searchParams.get("ok");
    if (ok === "criado") setMsg("Produto cadastrado");
    else if (ok === "atualizado") setMsg("Produto atualizado");
  }, [searchParams]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter(
      (p) =>
        p.codigo.toLowerCase().includes(q) ||
        p.descricao.toLowerCase().includes(q) ||
        (p.categoria?.nome || "").toLowerCase().includes(q)
    );
  }, [lista, busca]);

  async function toggleAtivo(p: Produto) {
    setError("");
    try {
      await api(`/produtos/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !p.ativo }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  async function excluirProduto(p: Produto) {
    if (!isAdmin) return;
    if (
      !confirm(
        `Excluir permanentemente «${p.codigo}»?\n\nSó funciona se não houver árvore, movimentação ou outros vínculos.`
      )
    ) {
      return;
    }
    setExcluindoId(p.id);
    setError("");
    setMsg("");
    try {
      await api(`/produtos/${p.id}`, { method: "DELETE" });
      setMsg(`Produto ${p.codigo} excluído`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir");
    } finally {
      setExcluindoId(null);
    }
  }

  async function toggleExpand(p: Produto) {
    if (expandidoId === p.id) {
      setExpandidoId(null);
      return;
    }
    const id = p.id;
    setExpandidoId(id);
    if (relCache[id]) return;
    setLoadingRel(id);
    try {
      const rel = await api<RelProduto>(`/produtos/${id}/relacionamentos`);
      setRelCache((prev) => ({ ...prev, [id]: rel }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao carregar relacionamentos"
      );
      setExpandidoId((cur) => (cur === id ? null : cur));
    } finally {
      setLoadingRel((cur) => (cur === id ? null : cur));
    }
  }

  function temHistorico(id: string) {
    const r = resumo[id];
    return !!r && r.fornecedores + r.clientes > 0;
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Produtos</h1>
        </div>
        {canEdit && (
          <Link
            href="/cadastros/produtos/novo"
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

      <div className="mt-4">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar código, descrição ou categoria…"
          className="w-full rounded-lg border bg-white px-3 py-2.5"
          autoComplete="off"
        />
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="w-12 pl-2 pr-1 py-2">Capa</th>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Descrição</th>
              <th className="px-3 py-2">Categoria</th>
              <th className="px-3 py-2">Un.</th>
              <th className="px-3 py-2 text-right">Preço</th>
              <th className="px-3 py-2">Mín.</th>
              <th className="px-3 py-2">Máx.</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => {
              const fotos = fotosResolvidas(p.fotos);
              const capaUrl = fotos[0] ?? null;
              const r = resumo[p.id];
              const hist = temHistorico(p.id);
              const aberto = expandidoId === p.id;
              const rel = relCache[p.id];
              const outroAberto = expandidoId !== null && !aberto;
              const rowTone = aberto
                ? "border-t bg-brand/[0.07]"
                : outroAberto
                  ? "border-t opacity-45"
                  : "border-t";
              return (
                <Fragment key={p.id}>
                  <tr
                    className={
                      aberto
                        ? `${rowTone} shadow-[inset_4px_0_0_0_#5B8B83]`
                        : rowTone
                    }
                  >
                    <td className="pl-2 pr-1 py-2">
                      <div className="flex items-center gap-1">
                        {hist ? (
                          <button
                            type="button"
                            onClick={() => void toggleExpand(p)}
                            className={
                              aberto
                                ? "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-brand/40 bg-brand/15 text-brand"
                                : "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 text-brand hover:bg-slate-50"
                            }
                            title={
                              aberto
                                ? "Recolher fornecedores/clientes"
                                : "Ver fornecedores e clientes do histórico"
                            }
                            aria-expanded={aberto}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              className={`h-3.5 w-3.5 transition-transform ${aberto ? "rotate-90" : ""}`}
                            >
                              <path
                                fillRule="evenodd"
                                d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                        ) : null}
                        {capaUrl ? (
                          <button
                            type="button"
                            onClick={() =>
                              setFotoLightbox({
                                images: fotos,
                                initialIndex: 0,
                                titulo: p.descricao,
                                codigo: p.codigo,
                              })
                            }
                            className="block cursor-zoom-in rounded ring-offset-2 transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-brand/50"
                            title={
                              fotos.length > 1
                                ? `Ampliar fotos (${fotos.length})`
                                : "Ampliar foto"
                            }
                            aria-label={`Ampliar foto de ${p.descricao}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={capaUrl}
                              alt=""
                              className="h-10 w-10 rounded object-cover"
                            />
                            {fotos.length > 1 ? (
                              <span className="sr-only">
                                {fotos.length} fotos
                              </span>
                            ) : null}
                          </button>
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400">
                            —
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {p.codigo}
                      {p.controlaSerie ? (
                        <span className="ml-2 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-800">
                          Série
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          aberto ? "font-semibold text-slate-900" : undefined
                        }
                      >
                        {p.descricao}
                      </span>
                      {hist && r && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          {r.fornecedores > 0 && (
                            <span>{r.fornecedores} forn.</span>
                          )}
                          {r.fornecedores > 0 && r.clientes > 0 && " · "}
                          {r.clientes > 0 && <span>{r.clientes} cli.</span>}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">{p.categoria?.nome}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {p.unidade || "UN"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {formatMoney(p.precoUnitario)}
                    </td>
                    <td className="px-3 py-2">{p.estoqueMinimo || "—"}</td>
                    <td className="px-3 py-2">{p.estoqueMaximo || "—"}</td>
                    <td className="px-3 py-2">{p.ativo ? "Ativo" : "Inativo"}</td>
                    <td className="space-x-3 whitespace-nowrap px-3 py-2">
                      <Link
                        href={`/cadastros/produtos/${p.id}`}
                        className="text-brand hover:underline"
                      >
                        {canEdit ? "Editar" : "Ver"}
                      </Link>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => toggleAtivo(p)}
                          className="text-brand hover:underline"
                        >
                          {p.ativo ? "Desativar" : "Ativar"}
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          disabled={excluindoId === p.id}
                          onClick={() => void excluirProduto(p)}
                          className="text-red-700 hover:underline disabled:opacity-50"
                        >
                          {excluindoId === p.id ? "Excluindo…" : "Excluir"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {aberto && (
                    <tr className="border-t border-brand/20 bg-brand/[0.04] shadow-[inset_4px_0_0_0_#5B8B83]">
                      <td colSpan={10} className="px-3 py-4">
                        {loadingRel === p.id && !rel && (
                          <p className="text-xs text-slate-400">Carregando…</p>
                        )}
                        {rel && (
                          <div className="grid gap-4 sm:grid-cols-2">
                            <RelacoesParceiros
                              titulo="Compramos de (fornecedores)"
                              itens={rel.fornecedores}
                              vazio="Nenhuma compra registrada deste produto."
                            />
                            <RelacoesParceiros
                              titulo="Vendemos / enviamos para (clientes)"
                              itens={rel.clientes}
                              vazio="Nenhuma venda/envio registrado deste produto."
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtrados.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-6 text-center text-slate-500"
                >
                  Nenhum produto encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ImageLightbox
        open={fotoLightbox !== null}
        onClose={() => setFotoLightbox(null)}
        images={fotoLightbox?.images ?? []}
        initialIndex={fotoLightbox?.initialIndex ?? 0}
        title={fotoLightbox?.titulo ?? ""}
        subtitle={fotoLightbox?.codigo}
      />
    </>
  );
}

function RelacoesParceiros({
  titulo,
  itens,
  vazio,
}: {
  titulo: string;
  itens: ParceiroRel[];
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
          {itens.map((c) => (
            <li
              key={c.clienteId}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5"
            >
              <div className="font-medium text-slate-900">{c.nome}</div>
              <div className="text-xs text-slate-500">{c.tipo}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {formatQty(c.quantidadeTotal)} · {c.movimentos} mov. · últ.{" "}
                {formatData(c.ultimaData)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
