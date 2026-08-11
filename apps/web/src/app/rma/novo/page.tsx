"use client";

import { api, apiUpload } from "@/lib/api";
import { matchNomeOuDocumento } from "@/lib/documento";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Cliente = {
  id: string;
  nome: string;
  tipo: string;
  documento?: string | null;
  ativo: boolean;
};
type Produto = {
  id: string;
  codigo: string;
  descricao: string;
  controlaSerie: boolean;
};

type LinhaForm = {
  key: string;
  produtoId: string;
  produtoQuery: string;
  numeroSerie: string;
  sugestoes: Produto[];
  open: boolean;
};

const MAX_ITENS_NOTA = 50;

function emptyLinha(): LinhaForm {
  return {
    key: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    produtoId: "",
    produtoQuery: "",
    numeroSerie: "",
    sugestoes: [],
    open: false,
  };
}

export default function RmaNovoPage() {
  const router = useRouter();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const [nfEntrada, setNfEntrada] = useState("");
  const [nfArquivo, setNfArquivo] = useState<string | null>(null);
  const [observacao, setObservacao] = useState("");
  const [totalNota, setTotalNota] = useState("");
  const [linhas, setLinhas] = useState<LinhaForm[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const linhasRef = useRef(linhas);
  linhasRef.current = linhas;
  const searchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );
  const searchAborts = useRef<Record<string, AbortController>>({});

  useEffect(() => {
    api<Cliente[]>("/clientes")
      .then((c) =>
        setClientes(
          c.filter((x) => x.ativo !== false && x.tipo !== "FORNECEDOR")
        )
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Erro"));
  }, []);

  const clientesFiltrados = useMemo(() => {
    return clientes
      .filter((c) => matchNomeOuDocumento(c.nome, c.documento, clienteQuery))
      .slice(0, 20);
  }, [clientes, clienteQuery]);

  function ajustarTotal(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setTotalNota("");
      setLinhas([]);
      return;
    }
    const n = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setTotalNota(trimmed);
      setLinhas([]);
      return;
    }
    let total = Math.floor(n);
    if (total > MAX_ITENS_NOTA) {
      total = MAX_ITENS_NOTA;
    }

    const prev = linhasRef.current;
    if (prev.length === total) {
      setTotalNota(String(total));
      return;
    }
    if (prev.length > total) {
      const aRemover = prev.slice(total);
      const temDados = aRemover.some(
        (r) => r.produtoId || r.numeroSerie.trim() || r.produtoQuery.trim()
      );
      if (
        temDados &&
        !window.confirm(
          `Reduzir para ${total} remove ${aRemover.length} linha(s) já preenchida(s). Continuar?`
        )
      ) {
        setTotalNota(String(prev.length));
        return;
      }
      setTotalNota(String(total));
      setLinhas(prev.slice(0, total));
      return;
    }

    setTotalNota(String(total));
    const extras = Array.from({ length: total - prev.length }, () =>
      emptyLinha()
    );
    setLinhas([...prev, ...extras]);
  }

  function onProdutoQuery(idx: number, value: string) {
    const key = linhas[idx]?.key;
    if (!key) return;
    setLinhas((prev) =>
      prev.map((row) =>
        row.key === key
          ? {
              ...row,
              produtoQuery: value,
              produtoId: "",
              open: true,
            }
          : row
      )
    );
    if (searchTimers.current[key]) clearTimeout(searchTimers.current[key]);
    searchAborts.current[key]?.abort();
    if (!value.trim()) {
      setLinhas((prev) =>
        prev.map((row) =>
          row.key === key ? { ...row, sugestoes: [] } : row
        )
      );
      return;
    }
    searchTimers.current[key] = setTimeout(async () => {
      const ac = new AbortController();
      searchAborts.current[key] = ac;
      try {
        const list = await api<Produto[]>(
          `/produtos/busca?q=${encodeURIComponent(value.trim())}`,
          { signal: ac.signal }
        );
        if (ac.signal.aborted) return;
        setLinhas((prev) =>
          prev.map((row) => {
            if (row.key !== key) return row;
            // Já selecionou nesse meio-tempo — não mexer
            if (row.produtoId) return row;
            return {
              ...row,
              sugestoes: list.filter((p) => p.controlaSerie),
              open: true,
            };
          })
        );
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setLinhas((prev) =>
          prev.map((row) =>
            row.key === key && !row.produtoId
              ? { ...row, sugestoes: [] }
              : row
          )
        );
      }
    }, 250);
  }

  function selecionarProduto(idx: number, p: Produto) {
    if (!p.controlaSerie) {
      setError(
        `Produto ${p.codigo} não controla série — use um produto com rastreio`
      );
      return;
    }
    const key = linhas[idx]?.key;
    if (key) {
      if (searchTimers.current[key]) clearTimeout(searchTimers.current[key]);
      searchAborts.current[key]?.abort();
    }
    setError("");
    setLinhas((prev) =>
      prev.map((row, i) =>
        i === idx || (key && row.key === key)
          ? {
              ...row,
              produtoId: p.id,
              produtoQuery: `${p.codigo} — ${p.descricao}`,
              sugestoes: [],
              open: false,
            }
          : row
      )
    );
  }

  async function resolverProdutoId(row: LinhaForm): Promise<string | null> {
    if (row.produtoId) return row.produtoId;
    const q = row.produtoQuery.trim();
    if (!q) return null;
    const codigoHint = q.split("—")[0]?.trim() || q;
    try {
      const list = await api<Produto[]>(
        `/produtos/busca?q=${encodeURIComponent(codigoHint)}`
      );
      const comSerie = list.filter((p) => p.controlaSerie);
      const exato = comSerie.find(
        (p) =>
          p.codigo.toLowerCase() === codigoHint.toLowerCase() ||
          `${p.codigo} — ${p.descricao}` === q
      );
      return exato?.id || null;
    } catch {
      return null;
    }
  }

  async function onUploadNf(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("context", "rma");
    fd.append("kind", "nf");
    const up = await apiUpload<{ url: string }>("/upload", fd);
    setNfArquivo(up.url);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    if (!clienteId) {
      setError("Selecione o cliente");
      return;
    }
    if (linhas.length === 0) {
      setError("Informe o total de produtos na nota de RMA");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const payloadItens: Array<{ produtoId: string; series: string[] }> = [];
      const seriesVistas = new Set<string>();
      const linhasResolvidas = [...linhas];

      for (let i = 0; i < linhasResolvidas.length; i++) {
        const row = linhasResolvidas[i];
        let produtoId = row.produtoId;
        if (!produtoId) {
          produtoId = (await resolverProdutoId(row)) || "";
          if (produtoId) {
            linhasResolvidas[i] = { ...row, produtoId };
            setLinhas((prev) =>
              prev.map((r, j) => (j === i ? { ...r, produtoId } : r))
            );
          }
        }
        const sn = row.numeroSerie.trim();
        if (!produtoId) {
          throw new Error(
            `Linha ${i + 1}: selecione o produto na lista de sugestões`
          );
        }
        if (!sn) {
          throw new Error(`Linha ${i + 1}: informe o número de série`);
        }
        const key = `${produtoId}::${sn.toLowerCase()}`;
        if (seriesVistas.has(key)) {
          throw new Error(`Linha ${i + 1}: número de série repetido na nota`);
        }
        seriesVistas.add(key);
        payloadItens.push({ produtoId, series: [sn] });
      }

      const created = await api<{ id: string }>("/rma", {
        method: "POST",
        body: JSON.stringify({
          clienteId,
          nfEntradaNumero: nfEntrada.trim() || null,
          nfEntradaArquivo: nfArquivo,
          observacao: observacao.trim() || null,
          itens: payloadItens,
        }),
      });
      router.push(`/rma/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mb-2">
        <Link href="/rma" className="text-sm text-brand underline">
          ← Voltar
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">Novo RMA</h1>
      <p className="mt-1 text-sm text-slate-500">
        Um RMA = uma NF de entrada. Cada produto/série entra no Estoque RMA; o
        laudo é anexado depois, um por item.
      </p>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="mt-4 space-y-4 rounded-xl border bg-white p-4"
      >
        <div className="relative">
          <label className="mb-1 block text-sm font-medium">Cliente *</label>
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm"
            value={clienteQuery}
            onChange={(e) => {
              setClienteQuery(e.target.value);
              setClienteId("");
              setClienteOpen(true);
            }}
            onFocus={() => setClienteOpen(true)}
            onBlur={() => setTimeout(() => setClienteOpen(false), 150)}
            placeholder="Buscar cliente…"
            autoComplete="off"
          />
          {clienteOpen && clienteQuery.trim() && !clienteId && (
            <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-white shadow-lg">
              {clientesFiltrados.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-500">
                  Nenhum cliente encontrado
                </li>
              ) : (
                clientesFiltrados.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-brand-light"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setClienteId(c.id);
                        setClienteQuery(
                          c.documento ? `${c.nome} · ${c.documento}` : c.nome
                        );
                        setClienteOpen(false);
                      }}
                    >
                      {c.nome}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">NF entrada (nº)</span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={nfEntrada}
              onChange={(e) => setNfEntrada(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Anexo NF entrada</span>
            <input
              type="file"
              accept=".pdf,image/*"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void onUploadNf(f).catch((err) =>
                    setError(err instanceof Error ? err.message : "Upload")
                  );
              }}
            />
            {nfArquivo && (
              <span className="mt-1 block text-xs text-emerald-700">
                Anexado
              </span>
            )}
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Observação</span>
          <textarea
            className="w-full rounded-lg border px-3 py-2"
            rows={2}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
        </label>

        <label className="block max-w-xs text-sm">
          <span className="mb-1 block font-medium">
            Total de produtos na Nota de RMA *
          </span>
          <input
            type="number"
            min={1}
            max={MAX_ITENS_NOTA}
            step={1}
            className="w-full rounded-lg border px-3 py-2"
            value={totalNota}
            onChange={(e) => ajustarTotal(e.target.value)}
            placeholder="Ex.: 3"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Ao preencher, abre uma linha por produto/série (máx. {MAX_ITENS_NOTA}
            ).
          </span>
        </label>

        {linhas.length > 0 && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Produtos da nota ({linhas.length})
            </h2>
            {linhas.map((it, idx) => (
              <div
                key={it.key}
                className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3"
              >
                <p className="text-xs font-medium text-slate-500">
                  Item {idx + 1}
                </p>
                <div className="relative">
                  <label className="mb-1 block text-sm font-medium">
                    Código do produto *
                  </label>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={it.produtoQuery}
                    placeholder="Código ou descrição…"
                    autoComplete="off"
                    onChange={(e) => onProdutoQuery(idx, e.target.value)}
                    onFocus={() =>
                      setLinhas((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, open: true } : row
                        )
                      )
                    }
                    onBlur={() =>
                      setTimeout(
                        () =>
                          setLinhas((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, open: false } : row
                            )
                          ),
                        150
                      )
                    }
                  />
                  {it.open && it.produtoQuery.trim() && !it.produtoId && (
                    <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-white shadow-lg">
                      {it.sugestoes.length === 0 ? (
                        <li className="px-3 py-2 text-sm text-slate-500">
                          Nenhum produto com série encontrado
                        </li>
                      ) : (
                        it.sugestoes.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm hover:bg-brand-light"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                selecionarProduto(idx, p);
                              }}
                            >
                              <span className="font-mono text-xs">
                                {p.codigo}
                              </span>{" "}
                              — {p.descricao}
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">
                    Número de série *
                  </span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
                    value={it.numeroSerie}
                    onChange={(e) =>
                      setLinhas((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? { ...row, numeroSerie: e.target.value }
                            : row
                        )
                      )
                    }
                    placeholder="S/N deste equipamento"
                    autoComplete="off"
                  />
                </label>
                {it.produtoQuery.trim() && !it.produtoId ? (
                  <p className="text-xs text-amber-800">
                    Selecione o produto na lista de sugestões (não basta digitar).
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving || linhas.length === 0}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Abrir RMA e entrar no estoque"}
        </button>
      </form>
    </>
  );
}
