"use client";

import { api } from "@/lib/api";
import { useCallback, useRef, useState } from "react";

export type ArvoreComponenteRelatorio = {
  produtoFilhoId?: string;
  codigo: string;
  descricao: string;
  quantidade: number;
  fantasma: boolean;
  temBom?: boolean;
  precoUnitario: number;
  valorLinha: number;
};

function money(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function qty(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function Chevron({ aberto }: { aberto: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 shrink-0 text-sky-700 transition-transform ${
        aberto ? "rotate-90" : ""
      }`}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"
      />
    </svg>
  );
}

export function ArvoreComponentesTabela({
  paiId,
  componentes,
  qtdComponentes,
}: {
  paiId: string;
  componentes: ArvoreComponenteRelatorio[];
  qtdComponentes: number;
}) {
  const [abertas, setAbertas] = useState<Set<string>>(() => new Set());
  const [filhos, setFilhos] = useState<
    Record<string, ArvoreComponenteRelatorio[]>
  >({});
  const [carregando, setCarregando] = useState<Set<string>>(() => new Set());
  const [erros, setErros] = useState<Record<string, string>>({});
  const filhosRef = useRef(filhos);
  filhosRef.current = filhos;
  const inflight = useRef(new Set<string>());

  const carregarFilhos = useCallback(async (id: string) => {
    if (filhosRef.current[id] || inflight.current.has(id)) return;
    inflight.current.add(id);
    setCarregando((c) => new Set(c).add(id));
    setErros((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
    try {
      const p = new URLSearchParams();
      p.set("produtoPaiId", id);
      p.set("explodir", "0");
      p.set("page", "1");
      p.set("pageSize", "1");
      const r = await api<{
        rows: Array<{
          produtoPaiId: string;
          componentes: ArvoreComponenteRelatorio[];
        }>;
      }>(`/relatorios/arvores?${p.toString()}`);
      const row = r.rows.find((x) => x.produtoPaiId === id) || r.rows[0];
      setFilhos((cur) => ({
        ...cur,
        [id]: row?.componentes || [],
      }));
    } catch (e) {
      setErros((cur) => ({
        ...cur,
        [id]:
          e instanceof Error
            ? e.message
            : "Não foi possível carregar a subárvore",
      }));
    } finally {
      inflight.current.delete(id);
      setCarregando((c) => {
        const n = new Set(c);
        n.delete(id);
        return n;
      });
    }
  }, []);

  const toggle = useCallback(
    (id: string) => {
      setAbertas((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
          return next;
        }
        next.add(id);
        queueMicrotask(() => {
          void carregarFilhos(id);
        });
        return next;
      });
    },
    [carregarFilhos]
  );

  const somaQtd = componentes.reduce(
    (s, c) => s + Number(c.quantidade || 0),
    0
  );
  const somaValor = componentes.reduce(
    (s, c) => s + Number(c.valorLinha || 0),
    0
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <thead className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="whitespace-nowrap px-4 py-2.5 sm:px-5">Código</th>
            <th className="min-w-[14rem] px-3 py-2.5">Componente</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">Qtd</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">Preço</th>
            <th className="whitespace-nowrap px-4 py-2.5 text-right sm:px-5">
              Valor
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {componentes.map((c) => (
            <LinhasComponente
              key={`${paiId}-${c.produtoFilhoId || c.codigo}`}
              c={c}
              depth={0}
              abertas={abertas}
              filhos={filhos}
              carregando={carregando}
              erros={erros}
              onToggle={toggle}
            />
          ))}
        </tbody>
        <tfoot className="border-t border-slate-200 bg-slate-50/80 text-sm font-semibold text-slate-800">
          <tr>
            <td
              className="px-4 py-3 text-xs font-medium text-slate-500 sm:px-5"
              colSpan={2}
            >
              Total · {qtdComponentes} item
              {qtdComponentes === 1 ? "" : "s"}
            </td>
            <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
              {qty(somaQtd)}
            </td>
            <td className="px-3 py-3 text-right text-slate-300">—</td>
            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums sm:px-5">
              {money(somaValor)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function LinhasComponente({
  c,
  depth,
  abertas,
  filhos,
  carregando,
  erros,
  onToggle,
}: {
  c: ArvoreComponenteRelatorio;
  depth: number;
  abertas: Set<string>;
  filhos: Record<string, ArvoreComponenteRelatorio[]>;
  carregando: Set<string>;
  erros: Record<string, string>;
  onToggle: (id: string) => void;
}) {
  const id = c.produtoFilhoId;
  const podeExpandir = Boolean(c.temBom && id);
  const aberto = Boolean(id && abertas.has(id));
  const pad = 16 + depth * 18;

  return (
    <>
      <tr
        className={`align-middle ${
          podeExpandir
            ? "cursor-pointer hover:bg-sky-50/70"
            : "hover:bg-slate-50/70"
        } ${depth > 0 ? "bg-slate-50/40" : ""}`}
        onClick={podeExpandir && id ? () => onToggle(id) : undefined}
        onKeyDown={
          podeExpandir && id
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle(id);
                }
              }
            : undefined
        }
        tabIndex={podeExpandir ? 0 : undefined}
        role={podeExpandir ? "button" : undefined}
        aria-expanded={podeExpandir ? aberto : undefined}
      >
        <td
          className="whitespace-nowrap py-2.5 font-mono text-xs font-medium text-slate-800"
          style={{ paddingLeft: pad, paddingRight: 16 }}
        >
          <span className="inline-flex items-center gap-1.5">
            {podeExpandir ? (
              <Chevron aberto={aberto} />
            ) : (
              <span
                className="inline-block h-3 w-3.5"
                aria-hidden
              />
            )}
            {c.codigo}
          </span>
        </td>
        <td className="min-w-[14rem] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-slate-800">{c.descricao}</span>
            {c.fantasma ? (
              <span
                className="rounded border border-amber-200/80 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
                title="Não baixa estoque"
              >
                Fantasma
              </span>
            ) : null}
            {podeExpandir ? (
              <span
                className="rounded border border-sky-200/80 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800"
                title="Clique para ver os itens desta subárvore"
              >
                {aberto ? "Recolher" : "Subárvore"}
              </span>
            ) : c.temBom ? (
              <span
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                title="Possui BOM, mas não foi possível expandir aqui"
              >
                Subárvore
              </span>
            ) : null}
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">
          {qty(c.quantidade)}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-600">
          {money(c.precoUnitario)}
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums text-slate-800 sm:px-5">
          {money(c.valorLinha)}
        </td>
      </tr>
      {aberto && id && carregando.has(id) ? (
        <tr className="bg-slate-50/70">
          <td
            colSpan={5}
            className="py-2.5 text-xs text-slate-500"
            style={{ paddingLeft: pad + 22 }}
          >
            Carregando itens do kit…
          </td>
        </tr>
      ) : null}
      {aberto && id && erros[id] ? (
        <tr className="bg-red-50/60">
          <td
            colSpan={5}
            className="py-2.5 text-xs text-red-600"
            style={{ paddingLeft: pad + 22 }}
          >
            {erros[id]}
          </td>
        </tr>
      ) : null}
      {aberto && id && !carregando.has(id) && !erros[id] && filhos[id] ? (
        filhos[id].length === 0 ? (
          <tr className="bg-slate-50/70">
            <td
              colSpan={5}
              className="py-2.5 text-xs text-slate-500"
              style={{ paddingLeft: pad + 22 }}
            >
              Esta subárvore não tem componentes cadastrados.
            </td>
          </tr>
        ) : (
          filhos[id].map((f) => (
            <LinhasComponente
              key={`${id}-${f.produtoFilhoId || f.codigo}`}
              c={f}
              depth={depth + 1}
              abertas={abertas}
              filhos={filhos}
              carregando={carregando}
              erros={erros}
              onToggle={onToggle}
            />
          ))
        )
      ) : null}
    </>
  );
}
